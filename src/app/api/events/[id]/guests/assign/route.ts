import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { broadcast } from "@/lib/sse";

const schema = z.object({
  guestIds: z.array(z.string()).min(1).max(2000),
  tableId: z.string().nullable(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({ where: { id } });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  if (parsed.data.tableId) {
    const table = await db.table.findUnique({ where: { id: parsed.data.tableId }, include: { layout: true } });
    if (!table || table.layout.id !== ev.layoutId) return NextResponse.json({ error: "Bad table" }, { status: 400 });
  }
  await db.guest.updateMany({
    where: { id: { in: parsed.data.guestIds }, eventId: id },
    data: { assignedTableId: parsed.data.tableId },
  });
  // Notify any open guest-lookup pages so they refresh if one of these guests is on screen.
  broadcast(id, { type: "guest-moved", guestIds: parsed.data.guestIds, tableId: parsed.data.tableId });
  return NextResponse.json({ ok: true });
}
