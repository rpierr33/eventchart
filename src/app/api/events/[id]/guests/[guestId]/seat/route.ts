import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const schema = z.object({
  tableId: z.string(),
  seatNumber: z.number().int().min(1).max(40).nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string; guestId: string }> }) {
  const { id, guestId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const guest = await db.guest.findUnique({ where: { id: guestId }, include: { event: true } });
  if (!guest || guest.eventId !== id || guest.event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const table = await db.table.findUnique({ where: { id: parsed.data.tableId } });
  if (!table) return NextResponse.json({ error: "Table not found" }, { status: 404 });
  if (parsed.data.seatNumber !== null && parsed.data.seatNumber > table.capacity) {
    return NextResponse.json({ error: `Seat ${parsed.data.seatNumber} > capacity ${table.capacity}` }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    // Detach guest from any existing seat
    const existing = await tx.seat.findFirst({ where: { assignedGuestId: guestId } });
    if (existing) {
      await tx.seat.update({ where: { id: existing.id }, data: { assignedGuestId: null } });
    }
    // Set guest's table
    await tx.guest.update({ where: { id: guestId }, data: { assignedTableId: parsed.data.tableId } });
    // If a specific seat: upsert and attach
    if (parsed.data.seatNumber !== null) {
      // Free anyone currently in that seat
      const occupant = await tx.seat.findUnique({
        where: { tableId_seatNumber: { tableId: parsed.data.tableId, seatNumber: parsed.data.seatNumber } },
      });
      if (occupant?.assignedGuestId && occupant.assignedGuestId !== guestId) {
        await tx.seat.update({ where: { id: occupant.id }, data: { assignedGuestId: null } });
      }
      await tx.seat.upsert({
        where: { tableId_seatNumber: { tableId: parsed.data.tableId, seatNumber: parsed.data.seatNumber } },
        update: { assignedGuestId: guestId },
        create: { tableId: parsed.data.tableId, seatNumber: parsed.data.seatNumber, assignedGuestId: guestId },
      });
    }
  });
  return NextResponse.json({ ok: true });
}
