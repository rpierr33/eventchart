import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { broadcast } from "@/lib/sse";

const schema = z.object({
  hostGuestId: z.string(),
  firstName: z.string().min(1).max(40),
  lastName: z.string().max(40).nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({ where: { publicSlug: slug }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const host = await db.guest.findUnique({ where: { id: parsed.data.hostGuestId }, include: { assignedTable: true } });
  if (!host || host.eventId !== event.id) return NextResponse.json({ error: "Host not found" }, { status: 404 });

  // Look for a placeholder plus-one of this host
  const placeholder = await db.guest.findFirst({
    where: { eventId: event.id, plusOneOfGuestId: host.id, isPlusOnePlaceholder: true },
  });

  let guest;
  if (placeholder) {
    guest = await db.guest.update({
      where: { id: placeholder.id },
      data: {
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName ?? host.lastName,
        isPlusOnePlaceholder: false,
        assignedTableId: placeholder.assignedTableId ?? host.assignedTableId,
        checkedInAt: new Date(),
      },
      include: { assignedTable: true },
    });
  } else {
    guest = await db.guest.create({
      data: {
        eventId: event.id,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName ?? host.lastName,
        plusOneOfGuestId: host.id,
        assignedTableId: host.assignedTableId,
        checkedInAt: new Date(),
      },
      include: { assignedTable: true },
    });
  }

  broadcast(event.id, { type: "plusone", guestId: guest.id });

  return NextResponse.json({
    ok: true,
    guest: {
      id: guest.id,
      firstName: guest.firstName,
      lastName: guest.lastName,
      tableId: guest.assignedTable?.id ?? null,
      tableLabel: guest.assignedTable?.label ?? null,
      tableXPct: guest.assignedTable?.xPct ?? null,
      tableYPct: guest.assignedTable?.yPct ?? null,
      tableDirections: guest.assignedTable?.directionsText ?? null,
    },
  });
}
