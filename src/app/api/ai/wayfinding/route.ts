import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { getAnthropic, MODEL } from "@/lib/anthropic";

const schema = z.object({
  eventId: z.string(),
  qrId: z.string().optional(),
});

const SYSTEM = `You generate one-sentence wayfinding directions for guests at an event.

Given the floor plan image and the list of tables (with x/y % positions) and the origin point where the guest is standing (x/y %), produce a "directionsText" for each table that describes how to walk from origin to that table relative to visible landmarks on the plan.

Output STRICT JSON only:
{"directions": [{"tableId": "...", "directionsText": "..."}]}

Rules:
- One sentence per table. Plain spoken English, under 20 words.
- Reference visible landmarks: bar, stage, entrance, dance floor, restrooms, window, far corner.
- Use cardinal-ish hints relative to the origin: "to your left as you enter", "past the bar on your right".
- Don't say "go to coordinates x,y". Say what they'd actually look for.
- Don't invent landmarks not on the plan.

Respond with ONLY JSON.`;

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const event = await db.event.findUnique({
    where: { id: parsed.data.eventId },
    include: {
      layout: { include: { tables: true } },
      qrCodes: parsed.data.qrId ? { where: { id: parsed.data.qrId } } : true,
    },
  });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!event.layout) return NextResponse.json({ error: "No layout" }, { status: 400 });

  const qr = event.qrCodes[0];
  const originX = qr?.scanOriginXPct ?? 50;
  const originY = qr?.scanOriginYPct ?? 100;

  const anthropic = getAnthropic();
  if (!anthropic) {
    const fallback = event.layout.tables.map(t => ({
      tableId: t.id,
      directionsText: dirFromOrigin(originX, originY, t.xPct, t.yPct, t.label),
    }));
    return NextResponse.json({ directions: fallback, source: "heuristic" });
  }

  // Fetch the image as base64
  try {
    const imgUrl = event.layout.sourceImageUrl.startsWith("http")
      ? event.layout.sourceImageUrl
      : new URL(event.layout.sourceImageUrl, req.url).toString();
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) throw new Error("Image fetch failed");
    const buf = await imgRes.arrayBuffer();
    const b64 = Buffer.from(buf).toString("base64");
    const ct = imgRes.headers.get("content-type") ?? "image/png";
    const mediaType = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(ct) ? ct : "image/png";

    const payload = {
      origin: { xPct: originX, yPct: originY, label: qr?.label ?? "scan point" },
      tables: event.layout.tables.map(t => ({ id: t.id, label: t.label, xPct: t.xPct, yPct: t.yPct })),
    };

    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif", data: b64 } },
          { type: "text", text: JSON.stringify(payload) },
        ],
      }],
    });
    const block = resp.content.find(b => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Empty AI");
    const json = extractJson(block.text);
    if (!json || !Array.isArray(json.directions)) throw new Error("AI returned no directions");
    return NextResponse.json({ directions: json.directions, source: "claude" });
  } catch (e) {
    const fallback = event.layout.tables.map(t => ({
      tableId: t.id,
      directionsText: dirFromOrigin(originX, originY, t.xPct, t.yPct, t.label),
    }));
    return NextResponse.json({ directions: fallback, source: "heuristic", aiError: e instanceof Error ? e.message : String(e) });
  }
}

function dirFromOrigin(ox: number, oy: number, tx: number, ty: number, label: string): string {
  const dx = tx - ox;
  const dy = ty - oy;
  const horiz = Math.abs(dx) > 15 ? (dx > 0 ? "to your right" : "to your left") : "straight ahead";
  const vert = Math.abs(dy) > 15 ? (dy > 0 ? "further into the room" : "near the back") : "in the middle of the room";
  return `${label} is ${horiz}, ${vert}.`;
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
