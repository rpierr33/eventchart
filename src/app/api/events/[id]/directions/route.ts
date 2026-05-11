import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const upsertSchema = z.object({
  tableId: z.string(),
  fromQrId: z.string().nullable(),
  directionsText: z.string().min(1).max(280),
});

const bulkSchema = z.object({
  directions: z.array(upsertSchema).max(2000),
});

async function getOwnedEvent(eventId: string, userId: string) {
  const ev = await db.event.findUnique({ where: { id: eventId } });
  if (!ev || ev.hostUserId !== userId) return null;
  return ev;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(id, userId);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const fromQrId = url.searchParams.get("fromQrId");

  if (!ev.layoutId) return NextResponse.json({ directions: [] });
  const where = fromQrId === "null" || fromQrId === ""
    ? { table: { layoutId: ev.layoutId }, fromQrId: null }
    : fromQrId
      ? { table: { layoutId: ev.layoutId }, fromQrId }
      : { table: { layoutId: ev.layoutId } };
  const rows = await db.tableDirection.findMany({ where });
  return NextResponse.json({ directions: rows });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(id, userId);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  // Validate each row's table+qr belong to this event
  if (!ev.layoutId) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });
  const tableIds = new Set((await db.table.findMany({ where: { layoutId: ev.layoutId }, select: { id: true } })).map(t => t.id));
  const qrIds = new Set((await db.qRCode.findMany({ where: { eventId: id }, select: { id: true } })).map(q => q.id));

  for (const d of parsed.data.directions) {
    if (!tableIds.has(d.tableId)) return NextResponse.json({ error: `Unknown table ${d.tableId}` }, { status: 400 });
    if (d.fromQrId !== null && !qrIds.has(d.fromQrId)) return NextResponse.json({ error: `Unknown QR ${d.fromQrId}` }, { status: 400 });
  }

  await db.$transaction(parsed.data.directions.map(d => {
    // Manual upsert since (tableId, fromQrId) with NULL fromQrId isn't a single unique key in Prisma's eyes
    return d.fromQrId === null
      ? db.tableDirection.upsert({
          where: { id: `null_${d.tableId}` }, // synthetic; we use raw query path below
          update: { directionsText: d.directionsText },
          create: { id: `null_${d.tableId}`, tableId: d.tableId, fromQrId: null, directionsText: d.directionsText },
        })
      : db.tableDirection.upsert({
          where: { id: `${d.fromQrId}_${d.tableId}` },
          update: { directionsText: d.directionsText },
          create: { id: `${d.fromQrId}_${d.tableId}`, tableId: d.tableId, fromQrId: d.fromQrId, directionsText: d.directionsText },
        });
  }));

  return NextResponse.json({ ok: true, count: parsed.data.directions.length });
}
