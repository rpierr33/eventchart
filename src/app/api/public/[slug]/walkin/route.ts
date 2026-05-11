import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { broadcast } from "@/lib/sse";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";

const schema = z.object({
  firstName: z.string().max(40).optional().default(""),
  lastName: z.string().max(40).optional().default(""),
  qrId: z.string().nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({
    where: { publicSlug: slug },
    include: { layout: { include: { tables: { include: { guests: true } } } } },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!event.allowWalkIns) return NextResponse.json({ error: "Walk-ins are disabled for this event." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  if (!parsed.data.firstName.trim() && !parsed.data.lastName.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  if (event.walkInMode === "AUTO_SEAT") {
    const tableId = pickOpenTable(event.layout?.tables ?? []);
    const guest = await db.guest.create({
      data: {
        eventId: event.id,
        firstName: parsed.data.firstName.trim() || "Walk-in",
        lastName: parsed.data.lastName.trim() || "",
        isWalkIn: true,
        assignedTableId: tableId,
        checkedInAt: new Date(),
      },
      include: { assignedTable: true },
    });
    broadcast(event.id, { type: "walkin-seated", guestId: guest.id });
    return NextResponse.json({
      status: "AUTO_SEATED",
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

  // Require host approval — queue + push notification (spec: "required, not optional")
  const wir = await db.walkInRequest.create({
    data: {
      eventId: event.id,
      firstName: parsed.data.firstName.trim() || "Walk-in",
      lastName: parsed.data.lastName.trim() || "",
      qrId: parsed.data.qrId ?? null,
      status: "PENDING",
    },
  });
  broadcast(event.id, { type: "walkin-pending", walkInId: wir.id });
  // Fire-and-forget push so the host's phone wakes the screen even when the live view is closed.
  // Don't await — push timing is independent of the guest's response.
  void sendPushToUser(event.hostUserId, {
    title: `Walk-in: ${wir.firstName} ${wir.lastName}`,
    body: `${event.name} — tap to approve or decline.`,
    url: `/dashboard/events/${event.id}/live`,
    tag: `walkin-${event.id}`,
  });
  return NextResponse.json({ status: "QUEUED", walkInId: wir.id });
}

function pickOpenTable(tables: { id: string; capacity: number; guests: { id: string }[] }[]): string | null {
  const open = tables.find(t => t.guests.length < t.capacity);
  return open?.id ?? null;
}
