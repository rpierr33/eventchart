import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

// "Generate QR per table" — one QR row per Table, bound to that table.
// Idempotent: if a table already has a bound QR, skip it.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({
    where: { id },
    include: { layout: { include: { tables: true } }, qrCodes: true },
  });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!ev.layout) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });

  const boundTableIds = new Set(ev.qrCodes.filter(q => q.tableId).map(q => q.tableId!));
  const toCreate = ev.layout.tables.filter(t => !boundTableIds.has(t.id));
  if (toCreate.length === 0) {
    return NextResponse.json({ created: 0, skipped: ev.layout.tables.length });
  }

  await db.qRCode.createMany({
    data: toCreate.map(t => ({
      eventId: id,
      label: t.label,
      scanOriginXPct: t.xPct,
      scanOriginYPct: t.yPct,
      tableId: t.id,
    })),
  });
  return NextResponse.json({ created: toCreate.length, skipped: ev.layout.tables.length - toCreate.length });
}
