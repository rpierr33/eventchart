import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const createSchema = z.object({
  firstName: z.string().min(1).max(40),
  lastName: z.string().max(40).optional().default(""),
  groupTag: z.string().max(40).nullable().optional(),
  notes: z.string().max(400).nullable().optional(),
  plusOneOfGuestId: z.string().nullable().optional(),
  isPlusOnePlaceholder: z.boolean().optional(),
});

async function getOwnedEvent(eventId: string, userId: string) {
  const ev = await db.event.findUnique({ where: { id: eventId } });
  if (!ev || ev.hostUserId !== userId) return null;
  return ev;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(id, userId);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guests = await db.guest.findMany({
    where: { eventId: id },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return NextResponse.json({ guests });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(id, userId);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  const guest = await db.guest.create({
    data: {
      eventId: id,
      firstName: parsed.data.firstName.trim(),
      lastName: (parsed.data.lastName ?? "").trim(),
      groupTag: parsed.data.groupTag ?? null,
      notes: parsed.data.notes ?? null,
      plusOneOfGuestId: parsed.data.plusOneOfGuestId ?? null,
      isPlusOnePlaceholder: parsed.data.isPlusOnePlaceholder ?? false,
    },
  });
  return NextResponse.json({ guest });
}
