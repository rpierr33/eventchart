import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

// Auto-generate every QR the floor plan implies:
//   - one per detected landmark (entrance, bar, stage, restrooms, dance floor, …)
//   - one per Section centroid (Bride's Side, VIP, Kids, …)
//   - one per Table (table-tent)
// Idempotent: skip anything that already has a QR (by label for landmarks, by FK for sections/tables).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({
    where: { id },
    include: {
      layout: { include: { tables: true, landmarks: true, sections: true } },
      qrCodes: true,
    },
  });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!ev.layout) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });

  const existingLandmarkLabels = new Set(
    ev.qrCodes.filter(q => !q.tableId && !q.sectionId).map(q => q.label.toLowerCase()),
  );
  const existingTableIds = new Set(ev.qrCodes.filter(q => q.tableId).map(q => q.tableId!));
  const existingSectionIds = new Set(ev.qrCodes.filter(q => q.sectionId).map(q => q.sectionId!));
  const omitted = new Set((ev.omittedLandmarkLabels ?? []).map(s => s.toLowerCase()));

  const newLandmarkQrs = ev.layout.landmarks
    .filter(l => !existingLandmarkLabels.has(l.label.toLowerCase()) && !omitted.has(l.label.toLowerCase()))
    .map(l => ({
      eventId: id,
      label: l.label,
      scanOriginXPct: l.xPct,
      scanOriginYPct: l.yPct,
      tableId: null,
      sectionId: null,
    }));

  const newSectionQrs = ev.layout.sections
    .filter(s => !existingSectionIds.has(s.id) && !omitted.has(s.label.toLowerCase()))
    .map(s => ({
      eventId: id,
      label: s.label,
      scanOriginXPct: s.xPct,
      scanOriginYPct: s.yPct,
      tableId: null,
      sectionId: s.id,
    }));

  const newTableQrs = ev.layout.tables
    .filter(t => !existingTableIds.has(t.id))
    .map(t => ({
      eventId: id,
      label: t.label,
      scanOriginXPct: t.xPct,
      scanOriginYPct: t.yPct,
      tableId: t.id,
      sectionId: null,
    }));

  const total = newLandmarkQrs.length + newSectionQrs.length + newTableQrs.length;
  if (total === 0) {
    return NextResponse.json({ created: 0, landmarks: 0, sections: 0, tables: 0, totalNow: ev.qrCodes.length });
  }

  await db.qRCode.createMany({ data: [...newLandmarkQrs, ...newSectionQrs, ...newTableQrs] });
  const totalNow = await db.qRCode.count({ where: { eventId: id } });
  return NextResponse.json({
    created: total,
    landmarks: newLandmarkQrs.length,
    sections: newSectionQrs.length,
    tables: newTableQrs.length,
    totalNow,
  });
}
