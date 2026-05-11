import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const schema = z.object({
  label: z.string().min(1).max(40).optional(),
  scanOriginXPct: z.number().min(0).max(100).nullable().optional(),
  scanOriginYPct: z.number().min(0).max(100).nullable().optional(),
});

async function authorize(eventId: string, qrId: string, userId: string) {
  const qr = await db.qRCode.findUnique({ where: { id: qrId }, include: { event: true } });
  if (!qr || qr.eventId !== eventId || qr.event.hostUserId !== userId) return null;
  return qr;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; qrId: string }> }) {
  const { id, qrId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const qr = await authorize(id, qrId, userId);
  if (!qr) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  const updated = await db.qRCode.update({ where: { id: qrId }, data: parsed.data });
  return NextResponse.json({ qr: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; qrId: string }> }) {
  const { id, qrId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const qr = await authorize(id, qrId, userId);
  if (!qr) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.qRCode.delete({ where: { id: qrId } });
  return NextResponse.json({ ok: true });
}
