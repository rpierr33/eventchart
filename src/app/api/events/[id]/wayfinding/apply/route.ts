import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const schema = z.object({
  directions: z.array(z.object({ tableId: z.string(), directionsText: z.string().max(200) })),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const event = await db.event.findUnique({ where: { id }, include: { layout: { include: { tables: true } } } });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
  const validTableIds = new Set(event.layout?.tables.map(t => t.id) ?? []);
  await db.$transaction(parsed.data.directions
    .filter(d => validTableIds.has(d.tableId))
    .map(d => db.table.update({ where: { id: d.tableId }, data: { directionsText: d.directionsText.slice(0, 200) } }))
  );
  return NextResponse.json({ ok: true });
}
