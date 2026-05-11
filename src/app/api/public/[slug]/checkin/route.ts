import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { broadcast } from "@/lib/sse";

const schema = z.object({ guestId: z.string() });

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({ where: { publicSlug: slug }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const guest = await db.guest.findUnique({ where: { id: parsed.data.guestId } });
  if (!guest || guest.eventId !== event.id) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await db.guest.update({
    where: { id: guest.id },
    data: {
      checkedInAt: guest.checkedInAt ?? new Date(),
      noShowFlaggedAt: null,
    },
    select: { id: true, checkedInAt: true, firstName: true, lastName: true, assignedTableId: true },
  });

  broadcast(event.id, { type: "checkin", guestId: updated.id, at: updated.checkedInAt });
  return NextResponse.json({ ok: true, guest: updated });
}
