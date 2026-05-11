import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; guestId: string }> }) {
  const { id, guestId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const guest = await db.guest.findUnique({ where: { id: guestId }, include: { event: true } });
  if (!guest || guest.eventId !== id || guest.event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.guest.update({
    where: { id: guestId },
    data: { noShowFlaggedAt: new Date(), assignedTableId: null, checkedInAt: null },
  });
  broadcast(id, { type: "guest-moved", guestId });
  return NextResponse.json({ ok: true });
}
