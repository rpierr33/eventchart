import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const schema = z.object({
  landmarks: z.array(z.object({
    label: z.string().min(1).max(40),
    xPct: z.number().min(0).max(100),
    yPct: z.number().min(0).max(100),
  })).max(50),
});

async function getOwnedEvent(eventId: string, userId: string) {
  const ev = await db.event.findUnique({ where: { id: eventId }, include: { layout: true } });
  if (!ev || ev.hostUserId !== userId) return null;
  return ev;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(id, userId);
  if (!ev || !ev.layout) return NextResponse.json({ landmarks: [] });
  const landmarks = await db.landmark.findMany({ where: { layoutId: ev.layout.id }, orderBy: { label: "asc" } });
  return NextResponse.json({ landmarks });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(id, userId);
  if (!ev || !ev.layout) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  await db.$transaction(async (tx) => {
    await tx.landmark.deleteMany({ where: { layoutId: ev.layout!.id } });
    await tx.landmark.createMany({
      data: parsed.data.landmarks.map(l => ({ ...l, layoutId: ev.layout!.id })),
    });
  });
  const landmarks = await db.landmark.findMany({ where: { layoutId: ev.layout.id }, orderBy: { label: "asc" } });
  return NextResponse.json({ landmarks });
}
