import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  sourceImageUrl: z.string().url().or(z.string().startsWith("/")),
  sourceImageWidth: z.number().int().positive(),
  sourceImageHeight: z.number().int().positive(),
  templateId: z.string().optional(),
});

async function getOwnedEvent(id: string, userId: string) {
  const ev = await db.event.findUnique({ where: { id } });
  if (!ev || ev.hostUserId !== userId) return null;
  return ev;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(eventId, userId);
  if (!ev) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const layout = await db.$transaction(async (tx) => {
    let cloned: { id: string } | null = null;
    if (parsed.data.templateId) {
      const tmpl = await tx.layout.findUnique({ where: { id: parsed.data.templateId }, include: { tables: true } });
      if (tmpl && tmpl.templateOwnerId === userId && tmpl.isTemplate) {
        cloned = await tx.layout.create({
          data: {
            name: tmpl.name,
            sourceImageUrl: tmpl.sourceImageUrl,
            sourceImageWidth: tmpl.sourceImageWidth,
            sourceImageHeight: tmpl.sourceImageHeight,
            isTemplate: false,
            tables: {
              create: tmpl.tables.map(t => ({
                label: t.label,
                capacity: t.capacity,
                xPct: t.xPct,
                yPct: t.yPct,
                directionsText: t.directionsText,
                notes: t.notes,
              })),
            },
          },
          select: { id: true },
        });
      }
    }

    const newLayout = cloned ?? await tx.layout.create({
      data: {
        name: parsed.data.name,
        sourceImageUrl: parsed.data.sourceImageUrl,
        sourceImageWidth: parsed.data.sourceImageWidth,
        sourceImageHeight: parsed.data.sourceImageHeight,
      },
      select: { id: true },
    });

    // If event already had a layout, delete it (cascade tables/seats)
    if (ev.layoutId && ev.layoutId !== newLayout.id) {
      await tx.event.update({ where: { id: eventId }, data: { layoutId: null } });
      await tx.layout.delete({ where: { id: ev.layoutId } }).catch(() => {});
    }
    await tx.event.update({ where: { id: eventId }, data: { layoutId: newLayout.id } });
    return tx.layout.findUnique({ where: { id: newLayout.id }, include: { tables: true } });
  });

  return NextResponse.json({ layout });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEvent(eventId, userId);
  if (!ev || !ev.layoutId) return NextResponse.json({ error: "No layout" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = z.object({
    saveAsTemplate: z.boolean().optional(),
    templateName: z.string().max(80).optional(),
  }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  if (parsed.data.saveAsTemplate) {
    const layout = await db.layout.findUnique({ where: { id: ev.layoutId }, include: { tables: true } });
    if (!layout) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // Clone the layout as a template owned by user
    await db.layout.create({
      data: {
        name: parsed.data.templateName ?? layout.name,
        sourceImageUrl: layout.sourceImageUrl,
        sourceImageWidth: layout.sourceImageWidth,
        sourceImageHeight: layout.sourceImageHeight,
        isTemplate: true,
        templateName: parsed.data.templateName ?? layout.name,
        templateOwnerId: userId,
        tables: {
          create: layout.tables.map(t => ({
            label: t.label,
            capacity: t.capacity,
            xPct: t.xPct,
            yPct: t.yPct,
            directionsText: t.directionsText,
            notes: t.notes,
          })),
        },
      },
    });
  }
  return NextResponse.json({ ok: true });
}
