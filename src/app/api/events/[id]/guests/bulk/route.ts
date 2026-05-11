import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const guestSchema = z.object({
  firstName: z.string().min(1).max(60),
  lastName: z.string().max(60).optional().default(""),
  tableLabel: z.string().max(40).nullable().optional(),
  groupTag: z.string().max(40).nullable().optional(),
  notes: z.string().max(400).nullable().optional(),
  plusOneOf: z.string().nullable().optional(),
  isPlaceholder: z.boolean().optional(),
  isVip: z.boolean().optional(),
});

const schema = z.object({ guests: z.array(guestSchema).max(2000) });

function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "").replace(/^t(?=\d)/, "table");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({
    where: { id },
    include: { layout: { include: { tables: true } } },
  });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  // Build label → tableId index for auto-resolution
  const labelIndex = new Map<string, string>();
  for (const t of ev.layout?.tables ?? []) {
    labelIndex.set(normalizeLabel(t.label), t.id);
  }
  function resolveTableId(label: string | null | undefined): string | null {
    if (!label) return null;
    return labelIndex.get(normalizeLabel(label)) ?? null;
  }

  const hosts = parsed.data.guests.filter(g => !g.plusOneOf);
  const plusOnes = parsed.data.guests.filter(g => !!g.plusOneOf);

  const created = await db.$transaction(async (tx) => {
    const hostMap = new Map<string, string>();
    const hostRecords = await Promise.all(hosts.map(g => tx.guest.create({
      data: {
        eventId: id,
        firstName: g.firstName.trim(),
        lastName: (g.lastName ?? "").trim(),
        groupTag: g.groupTag ?? null,
        notes: g.notes ?? null,
        assignedTableId: resolveTableId(g.tableLabel),
        isPlusOnePlaceholder: false,
        isVip: !!g.isVip,
      },
    })));
    for (const h of hostRecords) {
      hostMap.set(`${h.firstName.toLowerCase()}|${h.lastName.toLowerCase()}`, h.id);
    }

    const plusOneRecords = await Promise.all(plusOnes.map(g => {
      const hostName = (g.plusOneOf ?? "").trim().toLowerCase();
      const parts = hostName.split(/\s+/);
      const key = `${parts[0] ?? ""}|${parts.slice(1).join(" ")}`;
      const hostId = hostMap.get(key) ?? null;
      // Inherit host's table if not specified
      const hostTable = hostId ? hostRecords.find(h => h.id === hostId)?.assignedTableId ?? null : null;
      return tx.guest.create({
        data: {
          eventId: id,
          firstName: g.firstName.trim(),
          lastName: (g.lastName ?? "").trim(),
          groupTag: g.groupTag ?? null,
          notes: g.notes ?? null,
          assignedTableId: resolveTableId(g.tableLabel) ?? hostTable,
          plusOneOfGuestId: hostId,
          isPlusOnePlaceholder: !!g.isPlaceholder,
          isVip: !!g.isVip,
        },
      });
    }));

    return [...hostRecords, ...plusOneRecords];
  });

  const assignedCount = created.filter(g => g.assignedTableId).length;
  return NextResponse.json({
    count: created.length,
    assigned: assignedCount,
    unassigned: created.length - assignedCount,
  });
}
