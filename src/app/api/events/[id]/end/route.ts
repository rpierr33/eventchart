import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.redirect(new URL("/login", _req.url)); }
  const ev = await db.event.findUnique({ where: { id }, select: { hostUserId: true } });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.event.update({ where: { id }, data: { status: "ENDED" } });
  return NextResponse.redirect(new URL(`/dashboard/events/${id}`, _req.url));
}
