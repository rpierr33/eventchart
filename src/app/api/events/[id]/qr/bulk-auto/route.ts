import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

// Auto-generate every QR the floor plan implies: one per detected landmark + one per table.
// Idempotent: skip any landmark whose label already has a QR; skip any table already bound to a QR.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({
    where: { id },
    include: {
      layout: { include: { tables: true, landmarks: true } },
      qrCodes: true,
    },
  });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!ev.layout) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });

  const existingLabels = new Set(ev.qrCodes.filter(q => !q.tableId).map(q => q.label.toLowerCase()));
  const existingTableIds = new Set(ev.qrCodes.filter(q => q.tableId).map(q => q.tableId!));

  const newLandmarkQrs = ev.layout.landmarks
    .filter(l => !existingLabels.has(l.label.toLowerCase()))
    .map(l => ({
      eventId: id,
      label: l.label,
      scanOriginXPct: l.xPct,
      scanOriginYPct: l.yPct,
      tableId: null,
    }));

  const newTableQrs = ev.layout.tables
    .filter(t => !existingTableIds.has(t.id))
    .map(t => ({
      eventId: id,
      label: t.label,
      scanOriginXPct: t.xPct,
      scanOriginYPct: t.yPct,
      tableId: t.id,
    }));

  const total = newLandmarkQrs.length + newTableQrs.length;
  if (total === 0) {
    return NextResponse.json({ created: 0, landmarks: 0, tables: 0, totalNow: ev.qrCodes.length });
  }

  await db.qRCode.createMany({ data: [...newLandmarkQrs, ...newTableQrs] });
  const totalNow = await db.qRCode.count({ where: { eventId: id } });
  return NextResponse.json({
    created: total,
    landmarks: newLandmarkQrs.length,
    tables: newTableQrs.length,
    totalNow,
  });
}
