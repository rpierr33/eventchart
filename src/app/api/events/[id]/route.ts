import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { randomCode } from "@/lib/utils";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  venueName: z.string().max(120).nullable().optional(),
  date: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "LIVE", "ENDED"]).optional(),
  allowWalkIns: z.boolean().optional(),
  walkInMode: z.enum(["AUTO_SEAT", "REQUIRE_HOST_APPROVAL"]).optional(),
  lookupPrivacy: z.enum(["PUBLIC", "CODE_PROTECTED"]).optional(),
  eventCode: z.string().length(4).regex(/^\d{4}$/).nullable().optional(),
  noShowAutoFlagMinutes: z.number().int().min(5).max(240).optional(),
});

async function getOwnedEvent(id: string, userId: string) {
  const ev = await db.event.findUnique({ where: { id } });
  if (!ev || ev.hostUserId !== userId) return null;
  return ev;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const event = await getOwnedEvent(id, userId);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ event });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const event = await getOwnedEvent(id, userId);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const data = parsed.data;
  const patch: Record<string, unknown> = { ...data };
  if ("date" in data) patch.date = data.date ? new Date(data.date) : null;

  if (data.lookupPrivacy === "CODE_PROTECTED" && !event.eventCode && !data.eventCode) {
    patch.eventCode = randomCode(4);
  }
  if (data.lookupPrivacy === "PUBLIC") {
    patch.eventCode = null;
  }
  if (data.status === "LIVE" && !event.startsAt) {
    patch.startsAt = new Date();
  }

  const updated = await db.event.update({ where: { id }, data: patch });
  return NextResponse.json({ event: updated });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const event = await getOwnedEvent(id, userId);
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
