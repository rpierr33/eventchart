import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Returns the full guest list with table coords + directions so the PWA
// can cache it once and serve lookups offline. No PII beyond what the
// guest will see post-lookup (their own name + table). Cached aggressively
// by the service worker.
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({
    where: { publicSlug: slug },
    select: {
      id: true,
      lookupPrivacy: true,
    },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Code-protected events don't pre-cache (planner expects privacy).
  if (event.lookupPrivacy === "CODE_PROTECTED") {
    return NextResponse.json({ guests: [], offlineDisabled: true });
  }

  const url = new URL(req.url);
  const fromQrId = url.searchParams.get("fromQrId");

  const guests = await db.guest.findMany({
    where: { eventId: event.id },
    include: { assignedTable: true },
  });

  const tableIds = guests.map(g => g.assignedTableId).filter((x): x is string => !!x);
  const directionRows = tableIds.length === 0 ? [] : await db.tableDirection.findMany({
    where: {
      tableId: { in: tableIds },
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
    const dir = g.assignedTableId ? byTable.get(g.assignedTableId) : undefined;
    return {
      id: g.id,
      firstName: g.firstName,
      lastName: g.lastName,
      tableId: g.assignedTable?.id ?? null,
      tableLabel: g.assignedTable?.label ?? null,
      tableXPct: g.assignedTable?.xPct ?? null,
      tableYPct: g.assignedTable?.yPct ?? null,
      tableDirections: dir?.withOrigin ?? dir?.noOrigin ?? g.assignedTable?.directionsText ?? null,
    };
  });

  return NextResponse.json({
    guests: shaped,
    cachedAt: new Date().toISOString(),
  }, {
    headers: {
      // Allow service worker to cache; short browser cache to keep page snappy on revisit
      "cache-control": "public, max-age=60, stale-while-revalidate=600",
    },
  });
}
