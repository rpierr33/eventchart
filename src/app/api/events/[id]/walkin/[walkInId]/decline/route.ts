import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; walkInId: string }> }) {
  const { id, walkInId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({ where: { id }, select: { hostUserId: true } });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wir = await db.walkInRequest.findUnique({ where: { id: walkInId } });
  if (!wir || wir.eventId !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.walkInRequest.update({ where: { id: walkInId }, data: { status: "DECLINED", resolvedAt: new Date() } });
  broadcast(id, { type: "walkin-declined", walkInId });
  return NextResponse.json({ ok: true });
}
