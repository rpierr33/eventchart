import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const tableSchema = z.object({
  label: z.string().min(1).max(40),
  capacity: z.number().int().min(1).max(40),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  directionsText: z.string().max(200).nullable().optional(),
  notes: z.string().max(400).nullable().optional(),
  sectionId: z.string().nullable().optional(),
});

const bulkSchema = z.object({
  tables: z.array(tableSchema.extend({ id: z.string().optional() })),
  deleteIds: z.array(z.string()).optional(),
});

async function getOwnedEventWithLayout(eventId: string, userId: string) {
  const ev = await db.event.findUnique({ where: { id: eventId }, include: { layout: true } });
  if (!ev || ev.hostUserId !== userId) return null;
  return ev;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEventWithLayout(eventId, userId);
  if (!ev || !ev.layout) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = tableSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const table = await db.table.create({
    data: { layoutId: ev.layout.id, ...parsed.data, directionsText: parsed.data.directionsText ?? null, notes: parsed.data.notes ?? null },
  });
  return NextResponse.json({ table });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEventWithLayout(eventId, userId);
  if (!ev || !ev.layout) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const tables = await db.$transaction(async (tx) => {
    if (parsed.data.deleteIds?.length) {
      await tx.table.deleteMany({ where: { id: { in: parsed.data.deleteIds }, layoutId: ev.layout!.id } });
    }
    for (const t of parsed.data.tables) {
      const common = {
        label: t.label,
        capacity: t.capacity,
        xPct: t.xPct,
        yPct: t.yPct,
        directionsText: t.directionsText ?? null,
        notes: t.notes ?? null,
        ...(t.sectionId !== undefined ? { sectionId: t.sectionId } : {}),
      };
      if (t.id) {
        await tx.table.update({ where: { id: t.id }, data: common });
      } else {
        await tx.table.create({ data: { layoutId: ev.layout!.id, ...common } });
      }
    }
    return tx.table.findMany({ where: { layoutId: ev.layout!.id }, orderBy: { label: "asc" } });
  });

  return NextResponse.json({ tables });
}
