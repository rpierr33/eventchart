import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const event = await db.event.findUnique({
    where: { id },
    include: {
      layout: { include: { tables: true } },
      guests: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }] },
      qrCodes: true,
    },
  });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Auto-flag no-shows
  let cutoff: Date | null = null;
  if (event.status === "LIVE" && event.startsAt) {
    cutoff = new Date(event.startsAt.getTime() + event.noShowAutoFlagMinutes * 60_000);
  }
  const now = new Date();

  const pendingWalkIns = await db.walkInRequest.findMany({
    where: { eventId: id, status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });

  const totalGuests = event.guests.length;
  const checkedIn = event.guests.filter(g => g.checkedInAt).length;
  const walkInCount = event.guests.filter(g => g.isWalkIn).length;
  const noShowGuests = event.guests
    .filter(g => !g.checkedInAt && cutoff && cutoff <= now && !g.isWalkIn)
    .map(g => g.id);

  // Persist auto-flags
  if (noShowGuests.length > 0) {
    await db.guest.updateMany({
      where: { id: { in: noShowGuests }, noShowFlaggedAt: null },
      data: { noShowFlaggedAt: now },
    });
  }

  const layoutTables = event.layout?.tables.map(t => ({
    id: t.id,
    label: t.label,
    capacity: t.capacity,
    xPct: t.xPct,
    yPct: t.yPct,
    directionsText: t.directionsText,
    notes: t.notes,
  })) ?? [];

  // Pull seat assignments for granular display
  const seatRows = event.layout
    ? await db.seat.findMany({
        where: { tableId: { in: event.layout.tables.map(t => t.id) }, assignedGuestId: { not: null } },
        select: { tableId: true, seatNumber: true, assignedGuestId: true },
      })
    : [];

  return NextResponse.json({
    event: {
      id: event.id,
      name: event.name,
      venueName: event.venueName,
      status: event.status,
      publicSlug: event.publicSlug,
      startsAt: event.startsAt,
      allowWalkIns: event.allowWalkIns,
      walkInMode: event.walkInMode,
      noShowAutoFlagMinutes: event.noShowAutoFlagMinutes,
    },
    seats: seatRows,
    layout: event.layout ? {
      id: event.layout.id,
      sourceImageUrl: event.layout.sourceImageUrl,
      sourceImageWidth: event.layout.sourceImageWidth,
      sourceImageHeight: event.layout.sourceImageHeight,
      tables: layoutTables,
    } : null,
    guests: event.guests.map(g => ({
      id: g.id,
      firstName: g.firstName,
      lastName: g.lastName,
      assignedTableId: g.assignedTableId,
      groupTag: g.groupTag,
      checkedInAt: g.checkedInAt,
      isWalkIn: g.isWalkIn,
      noShowFlaggedAt: g.noShowFlaggedAt,
      plusOneOfGuestId: g.plusOneOfGuestId,
      isPlusOnePlaceholder: g.isPlusOnePlaceholder,
      notes: g.notes,
    })),
    qrCodes: event.qrCodes,
    pendingWalkIns,
    stats: {
      total: totalGuests,
      checkedIn,
      walkIns: walkInCount,
      noShows: event.guests.filter(g => g.noShowFlaggedAt).length,
    },
  });
}
