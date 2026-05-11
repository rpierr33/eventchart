import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { getAnthropic, MODEL } from "@/lib/anthropic";

const schema = z.object({
  eventId: z.string(),
  naturalConstraints: z.string().max(2000).optional(),
});

const SYSTEM = `You assign event guests to tables.

Output STRICT JSON only:
{"assignments": [{"guestId": "...", "tableId": "...", "reason": "..."}]}

Rules:
- Keep groupTag clusters at one table when capacity allows.
- Plus-ones go with their host (plusOneOfGuestId).
- Balance fill — don't put 11 at one table and 3 at another when capacity allows even split.
- Respect natural-language constraints from the planner (e.g., "Eric Shipp at the head table" or "kids together at the back").
- Already-assigned guests should keep their seats unless a constraint says otherwise.
- Don't exceed table capacity.
- Don't invent guests or tables. Only use IDs from the input.

Respond with ONLY the JSON.`;

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
      guests: true,
    },
  });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!event.layout) return NextResponse.json({ error: "No layout" }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) {
    // Heuristic fallback — no AI key. Group by groupTag, fill in order.
    const suggestions = heuristicAssign(event.guests, event.layout.tables);
    return NextResponse.json({ assignments: suggestions, source: "heuristic" });
  }

  const payload = {
    constraints: parsed.data.naturalConstraints ?? null,
    tables: event.layout.tables.map(t => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      notes: t.notes,
      currentSeated: event.guests.filter(g => g.assignedTableId === t.id).length,
    })),
    guests: event.guests.map(g => ({
      id: g.id,
      firstName: g.firstName,
      lastName: g.lastName,
      groupTag: g.groupTag,
      plusOneOfGuestId: g.plusOneOfGuestId,
      notes: g.notes,
      assignedTableId: g.assignedTableId,
    })),
  };

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    });
    const block = resp.content.find(b => b.type === "text");
    if (!block || block.type !== "text") throw new Error("Empty AI");
    const json = extractJson(block.text);
    if (!json || !Array.isArray(json.assignments)) throw new Error("AI returned no assignments");
    return NextResponse.json({ assignments: json.assignments, source: "claude" });
  } catch (e) {
    // Fallback to heuristic on AI failure
    const suggestions = heuristicAssign(event.guests, event.layout.tables);
    return NextResponse.json({ assignments: suggestions, source: "heuristic", aiError: e instanceof Error ? e.message : String(e) });
  }
}

type GuestRow = { id: string; firstName: string; lastName: string; groupTag: string | null; plusOneOfGuestId: string | null; assignedTableId: string | null };
type TableRow = { id: string; label: string; capacity: number };

function heuristicAssign(guests: GuestRow[], tables: TableRow[]) {
  const tableLoad = new Map<string, number>();
  for (const t of tables) tableLoad.set(t.id, guests.filter(g => g.assignedTableId === t.id).length);

  // Bucket unassigned by groupTag (null bucket per individual)
  const unassigned = guests.filter(g => !g.assignedTableId);
  const buckets = new Map<string, GuestRow[]>();
  for (const g of unassigned) {
    const key = g.groupTag ?? `__solo_${g.id}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(g);
  }
  // Plus-ones follow their host
  const assigned = new Map<string, string>(); // guestId → tableId

  // Sort buckets by size desc so big groups get first pick
  const sortedBuckets = [...buckets.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [, group] of sortedBuckets) {
    // Find a table that fits the group
    const fits = tables.find(t => (tableLoad.get(t.id) ?? 0) + group.length <= t.capacity);
    if (fits) {
      for (const g of group) {
        assigned.set(g.id, fits.id);
        tableLoad.set(fits.id, (tableLoad.get(fits.id) ?? 0) + 1);
      }
    } else {
      // Split across tables, prefer least-filled
      for (const g of group) {
        const target = tables
          .map(t => ({ t, free: t.capacity - (tableLoad.get(t.id) ?? 0) }))
          .filter(x => x.free > 0)
          .sort((a, b) => b.free - a.free)[0]?.t;
        if (target) {
          assigned.set(g.id, target.id);
          tableLoad.set(target.id, (tableLoad.get(target.id) ?? 0) + 1);
        }
      }
    }
  }

  // Move plus-ones to their host's table when possible
  for (const g of unassigned) {
    if (g.plusOneOfGuestId) {
      const hostTable = assigned.get(g.plusOneOfGuestId) ?? guests.find(h => h.id === g.plusOneOfGuestId)?.assignedTableId ?? null;
      if (hostTable && (tableLoad.get(hostTable) ?? 0) < (tables.find(t => t.id === hostTable)?.capacity ?? 0)) {
        const prev = assigned.get(g.id);
        if (prev) tableLoad.set(prev, (tableLoad.get(prev) ?? 0) - 1);
        assigned.set(g.id, hostTable);
        tableLoad.set(hostTable, (tableLoad.get(hostTable) ?? 0) + 1);
      }
    }
  }

  return Array.from(assigned, ([guestId, tableId]) => ({ guestId, tableId, reason: "Grouped by tag, balanced fill" }));
}

function extractJson(text: string): { assignments?: unknown[] } | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(raw.slice(first, last + 1)); } catch { return null; }
}
