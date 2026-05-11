import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

const schema = z.object({ tableId: z.string().nullable().optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string; walkInId: string }> }) {
  const { id, walkInId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({
    where: { id },
    include: { layout: { include: { tables: { include: { guests: true } } } } },
  });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wir = await db.walkInRequest.findUnique({ where: { id: walkInId } });
  if (!wir || wir.eventId !== id || wir.status !== "PENDING") return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  let tableId: string | null = parsed.data.tableId ?? null;
  if (!tableId && ev.layout) {
    const open = ev.layout.tables.find(t => t.guests.length < t.capacity);
    tableId = open?.id ?? null;
  }

  const result = await db.$transaction(async (tx) => {
    const guest = await tx.guest.create({
      data: {
        eventId: id,
        firstName: wir.firstName,
        lastName: wir.lastName,
        isWalkIn: true,
        assignedTableId: tableId,
        checkedInAt: new Date(),
      },
    });
    await tx.walkInRequest.update({
      where: { id: walkInId },
      data: { status: "APPROVED", guestId: guest.id, resolvedAt: new Date() },
    });
    return guest;
  });
  broadcast(id, { type: "walkin-seated", guestId: result.id });
  return NextResponse.json({ ok: true, guest: result });
}
