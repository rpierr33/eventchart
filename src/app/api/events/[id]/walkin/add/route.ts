import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

const schema = z.object({
  firstName: z.string().max(40).optional().default(""),
  lastName: z.string().max(40).optional().default(""),
  tableId: z.string().nullable().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({
    where: { id },
    include: { layout: { include: { tables: { include: { guests: true } } } } },
  });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  if (!parsed.data.firstName.trim() && !parsed.data.lastName.trim()) return NextResponse.json({ error: "Name required" }, { status: 400 });

  let tableId: string | null = parsed.data.tableId ?? null;
  if (!tableId && ev.layout) {
    const open = ev.layout.tables.find(t => t.guests.length < t.capacity);
    tableId = open?.id ?? null;
  }

  const guest = await db.guest.create({
    data: {
      eventId: id,
      firstName: parsed.data.firstName.trim() || "Walk-in",
      lastName: parsed.data.lastName.trim() || "",
      isWalkIn: true,
      assignedTableId: tableId,
      checkedInAt: new Date(),
    },
  });
  broadcast(id, { type: "walkin-seated", guestId: guest.id });
  return NextResponse.json({ ok: true, guest });
}
