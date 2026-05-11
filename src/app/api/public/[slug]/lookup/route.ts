import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const schema = z.object({
  lastName: z.string().min(1).max(80),
  fromQrId: z.string().nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({
    where: { publicSlug: slug },
    select: { id: true, status: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const ln = parsed.data.lastName.trim().toLowerCase();
  const fromQrId = parsed.data.fromQrId ?? null;

  const guests = await db.guest.findMany({
    where: {
      eventId: event.id,
      lastName: { equals: ln, mode: "insensitive" },
    },
    include: { assignedTable: true },
    orderBy: { firstName: "asc" },
  });

  if (guests.length === 0) return NextResponse.json({ kind: "none" });

  // Pull origin-aware directions for assigned tables in one query
  const assignedTableIds = guests.map(g => g.assignedTableId).filter((x): x is string => !!x);
  const directionRows = assignedTableIds.length === 0 ? [] : await db.tableDirection.findMany({
    where: {
      tableId: { in: assignedTableIds },
      OR: fromQrId ? [{ fromQrId }, { fromQrId: null }] : [{ fromQrId: null }],
    },
  });
  const byTable = new Map<string, { withOrigin?: string; noOrigin?: string }>();
  for (const row of directionRows) {
    const entry = byTable.get(row.tableId) ?? {};
    if (row.fromQrId === fromQrId && fromQrId) entry.withOrigin = row.directionsText;
    else if (row.fromQrId === null) entry.noOrigin = row.directionsText;
    byTable.set(row.tableId, entry);
  }

  const shaped = guests.map(g => {
    const direction = g.assignedTableId ? byTable.get(g.assignedTableId) : undefined;
    const tableDirections =
      direction?.withOrigin ??
      direction?.noOrigin ??
      g.assignedTable?.directionsText ?? // legacy fallback
      null;
    return {
      id: g.id,
      firstName: g.firstName,
      lastName: g.lastName,
      tableId: g.assignedTable?.id ?? null,
      tableLabel: g.assignedTable?.label ?? null,
      tableXPct: g.assignedTable?.xPct ?? null,
      tableYPct: g.assignedTable?.yPct ?? null,
      tableDirections,
    };
  });

  if (shaped.length === 1) return NextResponse.json({ kind: "single", match: shaped[0] });
  return NextResponse.json({ kind: "matches", matches: shaped });
}
