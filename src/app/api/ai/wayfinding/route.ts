import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { getAnthropic, MODEL } from "@/lib/anthropic";

const schema = z.object({
  eventId: z.string(),
  // optional: limit to a single QR origin (otherwise generate for every QR + a null-origin default)
  qrId: z.string().nullable().optional(),
});

const SYSTEM = `You write one-sentence wayfinding directions for event guests.

You will be given:
- A floor-plan image
- A set of tables, each with a label and (x%, y%) position
- One origin point: the position where the guest is standing right now (x%, y%, plus a human label like "Main Entrance")

Produce one direction per table, written from THAT origin. The direction must read naturally for someone standing at the origin looking at the room. Reference visible landmarks (stage, bar, dance floor, restrooms, window, far corner, doors). Use plain spoken English. Under 22 words. No coordinates.

Output STRICT JSON:
{"directions": [{"tableId": "...", "directionsText": "..."}]}

Rules:
- Anchor every sentence to the named origin if it helps clarity, but you don't have to repeat the origin in every sentence.
- Cardinal hints from the origin: "to your left as you enter", "past the bar on your right", "the round table farthest from the stage".
- Do not invent landmarks not visible on the plan.
- One sentence per table. No prose outside JSON.`;

type TableRow = { id: string; label: string; xPct: number; yPct: number };
type QrRow = { id: string; label: string; scanOriginXPct: number; scanOriginYPct: number };

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const event = await db.event.findUnique({
    where: { id: parsed.data.eventId },
    include: { layout: { include: { tables: true } }, qrCodes: true },
  });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!event.layout) return NextResponse.json({ error: "No layout" }, { status: 400 });
  if (event.layout.tables.length === 0) return NextResponse.json({ error: "No tables yet" }, { status: 400 });

  const tables: TableRow[] = event.layout.tables.map(t => ({ id: t.id, label: t.label, xPct: t.xPct, yPct: t.yPct }));

  // Origins to generate for. Always include a null-origin default. Include each QR (or just the requested one).
  type Origin = { id: string | null; label: string; xPct: number; yPct: number };
  const origins: Origin[] = [];
  if (parsed.data.qrId) {
    const qr = event.qrCodes.find(q => q.id === parsed.data.qrId);
    if (!qr) return NextResponse.json({ error: "QR not found" }, { status: 404 });
    origins.push({ id: qr.id, label: qr.label, xPct: qr.scanOriginXPct, yPct: qr.scanOriginYPct });
  } else {
    for (const qr of event.qrCodes as QrRow[]) {
      origins.push({ id: qr.id, label: qr.label, xPct: qr.scanOriginXPct, yPct: qr.scanOriginYPct });
    }
    // Always also produce a no-origin fallback (used when the guest opens the URL without ?qr=)
    if (origins.length === 0 || !origins.some(o => o.id === null)) {
      origins.push({ id: null, label: "the venue entrance", xPct: 50, yPct: 8 });
    }
  }

  const anthropic = getAnthropic();
  const useAi = !!anthropic;

  // Pull the image once if we'll call AI
  let imageData: { mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; b64: string } | null = null;
  if (useAi) {
    try {
      const imgUrl = event.layout.sourceImageUrl.startsWith("http")
        ? event.layout.sourceImageUrl
        : new URL(event.layout.sourceImageUrl, req.url).toString();
      const r = await fetch(imgUrl);
      if (r.ok) {
        const buf = await r.arrayBuffer();
        const ct = r.headers.get("content-type") ?? "image/png";
        const mediaType = (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(ct) ? ct : "image/png") as typeof imageData extends infer X ? X extends { mediaType: infer M } ? M : never : never;
        imageData = { mediaType, b64: Buffer.from(buf).toString("base64") };
      }
    } catch { /* fall through to heuristic */ }
  }

  // Produce directions per origin
  type Out = { fromQrId: string | null; directions: Array<{ tableId: string; directionsText: string }>; source: "claude" | "heuristic" };
  const results: Out[] = [];

  for (const origin of origins) {
    let directions: Array<{ tableId: string; directionsText: string }> = [];
    let source: "claude" | "heuristic" = "heuristic";

    if (useAi && imageData && anthropic) {
      try {
        const payload = {
          origin: { xPct: origin.xPct, yPct: origin.yPct, label: origin.label },
          tables: tables.map(t => ({ id: t.id, label: t.label, xPct: t.xPct, yPct: t.yPct })),
        };
        const resp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 4096,
          system: SYSTEM,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: imageData.mediaType, data: imageData.b64 } },
              { type: "text", text: JSON.stringify(payload) },
            ],
          }],
        });
        const block = resp.content.find(b => b.type === "text");
        if (block && block.type === "text") {
          const json = extractJson(block.text);
          if (json && Array.isArray(json.directions)) {
            directions = (json.directions as Array<{ tableId?: unknown; directionsText?: unknown }>)
              .filter(d => typeof d.tableId === "string" && typeof d.directionsText === "string")
              .map(d => ({ tableId: String(d.tableId), directionsText: String(d.directionsText).slice(0, 280) }));
            source = "claude";
          }
        }
      } catch { /* fall through */ }
    }

    if (directions.length === 0) {
      // Heuristic fallback per origin
      directions = tables.map(t => ({
        tableId: t.id,
        directionsText: heuristicSentence(origin.xPct, origin.yPct, t.xPct, t.yPct, t.label, origin.label),
      }));
      source = "heuristic";
    }

    results.push({ fromQrId: origin.id, directions, source });
  }

  // Persist — delete-then-create per origin so partial unique index (tableId where fromQrId IS NULL)
  // can't collide. Each origin is independent so transactions are scoped per origin.
  let persistedCount = 0;
  for (const r of results) {
    const tableIds = r.directions.map(d => d.tableId);
    await db.$transaction(async (tx) => {
      await tx.tableDirection.deleteMany({
        where: { fromQrId: r.fromQrId, tableId: { in: tableIds } },
      });
      await tx.tableDirection.createMany({
        data: r.directions.map(d => ({
          tableId: d.tableId,
          fromQrId: r.fromQrId,
          directionsText: d.directionsText,
        })),
      });
    });
    persistedCount += r.directions.length;
  }

  return NextResponse.json({ results, persistedCount });
}

function heuristicSentence(ox: number, oy: number, tx: number, ty: number, label: string, originLabel: string): string {
  const dx = tx - ox;
  const dy = ty - oy;
  const horiz = Math.abs(dx) > 12 ? (dx > 0 ? "to your right" : "to your left") : "straight ahead";
  const vert = Math.abs(dy) > 12 ? (dy > 0 ? "further into the room" : "back toward the entrance") : "in the center";
  return `From ${originLabel}, ${label} is ${horiz}, ${vert}.`;
}

function extractJson(text: string): { directions?: unknown[] } | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(raw.slice(first, last + 1)); } catch { return null; }
}
