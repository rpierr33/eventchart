import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { getAnthropic, MODEL } from "@/lib/anthropic";

const schema = z.object({
  eventId: z.string(),
  walkInId: z.string(),
  // Optional override — host hasn't persisted yet but wants to preview a VIP recommendation.
  vipOverride: z.boolean().optional(),
});

const SYSTEM = `You recommend the best table for an incoming walk-in guest.

Output STRICT JSON only:
{"tableId": "...", "reason": "..."}

Decision factors:
- Same last name or matching groupTag with already-seated guests → seat them together (likely family).
- Avoid tables with dietary/accessibility conflicts in notes.
- Prefer tables with clusters of free seats (2+ adjacent) when multiple walk-ins arrive together.
- VIP indicators in walk-in notes → better table (low table number, near stage).
- Spread walk-ins so no single table goes over capacity.

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
      layout: { include: { tables: { include: { guests: true } } } },
      guests: true,
    },
  });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!event.layout) return NextResponse.json({ error: "No layout" }, { status: 400 });

  const walkIn = await db.walkInRequest.findUnique({ where: { id: parsed.data.walkInId } });
  if (!walkIn || walkIn.eventId !== event.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // VIP override from the modal takes precedence over persisted isVip.
  const isVip = parsed.data.vipOverride ?? walkIn.isVip;

  // Heuristic: VIP → prefer the lowest-numbered open table (closest to head/front).
  // Otherwise: same last name on a table > most open seats > first open
  type GuestRow = { id: string; lastName: string; firstName: string; groupTag: string | null; notes: string | null };
  type TableRow = { id: string; label: string; capacity: number; notes: string | null; guests: GuestRow[] };
  const tables = event.layout.tables as TableRow[];

  function tableNumeric(label: string): number {
    const m = label.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 999;
  }

  let heuristicChoice: string | null = null;
  let heuristicReason = "Most open seats";
  if (isVip) {
    const vipPick = tables
      .filter(t => t.guests.length < t.capacity)
      .sort((a, b) => tableNumeric(a.label) - tableNumeric(b.label))[0];
    if (vipPick) {
      heuristicChoice = vipPick.id;
      heuristicReason = `VIP — seated at ${vipPick.label} (front of room)`;
    }
  }
  let sameSurname: TableRow | undefined;
  if (!heuristicChoice) {
    sameSurname = tables.find((t: TableRow) =>
      t.guests.some((g: GuestRow) => g.lastName.toLowerCase() === walkIn.lastName.toLowerCase() && walkIn.lastName.length > 0)
      && t.guests.length < t.capacity
    );
    heuristicChoice = sameSurname?.id ??
      tables
        .filter((t: TableRow) => t.guests.length < t.capacity)
        .sort((a: TableRow, b: TableRow) => (b.capacity - b.guests.length) - (a.capacity - a.guests.length))[0]?.id ?? null;
    if (sameSurname) heuristicReason = `Matches surname "${walkIn.lastName}" already at this table`;
  }

  const anthropic = getAnthropic();
  if (!anthropic || !heuristicChoice) {
    return NextResponse.json({
      tableId: heuristicChoice,
      reason: heuristicReason,
      source: "heuristic",
    });
  }

  const payload = {
    walkIn: { firstName: walkIn.firstName, lastName: walkIn.lastName, notes: walkIn.notes, isVip },
    tables: tables.map((t: TableRow) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      notes: t.notes,
      seated: t.guests.map((g: GuestRow) => ({ firstName: g.firstName, lastName: g.lastName, groupTag: g.groupTag, notes: g.notes })),
      open: t.capacity - t.guests.length,
    })).filter((t: { open: number }) => t.open > 0),
  };

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const block = resp.content.find(b => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Empty AI");
    const json = extractJson(block.text);
    if (!json || !json.tableId) throw new Error("AI returned no tableId");
    return NextResponse.json({ tableId: json.tableId, reason: json.reason ?? "Claude pick", source: "claude" });
  } catch {
    return NextResponse.json({ tableId: heuristicChoice, reason: heuristicReason, source: "heuristic" });
  }
}

function extractJson(text: string): { tableId?: string; reason?: string } | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(raw.slice(first, last + 1)); } catch { return null; }
}
