import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const schema = z.object({ isVip: z.boolean() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string; walkInId: string }> }) {
  const { id, walkInId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({ where: { id }, select: { hostUserId: true } });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const wir = await db.walkInRequest.findUnique({ where: { id: walkInId } });
  if (!wir || wir.eventId !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  await db.walkInRequest.update({ where: { id: walkInId }, data: { isVip: parsed.data.isVip } });
  return NextResponse.json({ ok: true });
}
