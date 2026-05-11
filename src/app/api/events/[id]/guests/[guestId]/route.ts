import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const patchSchema = z.object({
  firstName: z.string().min(1).max(40).optional(),
  lastName: z.string().max(40).optional(),
  groupTag: z.string().max(40).nullable().optional(),
  notes: z.string().max(400).nullable().optional(),
  plusOneOfGuestId: z.string().nullable().optional(),
  isPlusOnePlaceholder: z.boolean().optional(),
  assignedTableId: z.string().nullable().optional(),
  isVip: z.boolean().optional(),
});

async function authorize(eventId: string, guestId: string, userId: string) {
  const guest = await db.guest.findUnique({ where: { id: guestId }, include: { event: true } });
  if (!guest || guest.eventId !== eventId || guest.event.hostUserId !== userId) return null;
  return guest;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; guestId: string }> }) {
  const { id, guestId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const guest = await authorize(id, guestId, userId);
  if (!guest) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  const updated = await db.guest.update({ where: { id: guestId }, data: parsed.data });
  return NextResponse.json({ guest: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; guestId: string }> }) {
  const { id, guestId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const guest = await authorize(id, guestId, userId);
  if (!guest) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.guest.delete({ where: { id: guestId } });
  return NextResponse.json({ ok: true });
}
