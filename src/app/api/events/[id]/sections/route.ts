import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const polygonSchema = z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(20).optional().nullable();

const sectionInputSchema = z.object({
  id: z.string().optional(),  // for upserts
  label: z.string().min(1).max(40),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  color: z.string().max(20).nullable().optional(),
  polygon: polygonSchema,
});

const putSchema = z.object({
  sections: z.array(sectionInputSchema).max(50),
  // Optional: also reassign which tables belong to which section.
  // Map of tableId → sectionId|null. Untouched tables keep their current sectionId.
  tableAssignments: z.record(z.string(), z.string().nullable()).optional(),
  // If true: any pre-existing section for this layout not in the input is deleted.
  replace: z.boolean().optional(),
});

async function getOwnedEventWithLayout(eventId: string, userId: string) {
  const ev = await db.event.findUnique({ where: { id: eventId }, include: { layout: true } });
  if (!ev || ev.hostUserId !== userId) return null;
  return ev;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEventWithLayout(id, userId);
  if (!ev || !ev.layout) return NextResponse.json({ sections: [] });
  const sections = await db.section.findMany({
    where: { layoutId: ev.layout.id },
    orderBy: { label: "asc" },
    include: { _count: { select: { tables: true } } },
  });
  return NextResponse.json({ sections });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await getOwnedEventWithLayout(id, userId);
  if (!ev || !ev.layout) return NextResponse.json({ error: "Add a layout first" }, { status: 400 });
  const layoutId = ev.layout.id;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const result = await db.$transaction(async (tx) => {
    const incoming = parsed.data.sections;
    const existing = await tx.section.findMany({ where: { layoutId } });

    // Match by id where provided; otherwise upsert by label (case-insensitive)
    const byId = new Map(existing.map(s => [s.id, s]));
    const byLabel = new Map(existing.map(s => [s.label.toLowerCase(), s]));
    const keep = new Set<string>();

    for (const inp of incoming) {
      const match = (inp.id && byId.get(inp.id)) || byLabel.get(inp.label.toLowerCase());
      // Prisma's JSON field needs `Prisma.JsonNull` (not bare null) when clearing.
      // Using `?? Prisma.JsonNull` would require an import; passing the value
      // directly works when it's an array, and we omit the key when undefined.
      const polygonJson = inp.polygon ?? undefined;
      if (match) {
        await tx.section.update({
          where: { id: match.id },
          data: {
            label: inp.label,
            xPct: inp.xPct,
            yPct: inp.yPct,
            color: inp.color ?? null,
            ...(polygonJson !== undefined ? { polygon: polygonJson } : {}),
          },
        });
        keep.add(match.id);
      } else {
        const created = await tx.section.create({
          data: {
            layoutId,
            label: inp.label,
            xPct: inp.xPct,
            yPct: inp.yPct,
            color: inp.color ?? null,
            ...(polygonJson !== undefined ? { polygon: polygonJson } : {}),
          },
        });
        keep.add(created.id);
      }
    }

    if (parsed.data.replace) {
      // Delete sections not in the keep set
      await tx.section.deleteMany({ where: { layoutId, id: { notIn: Array.from(keep) } } });
    }

    if (parsed.data.tableAssignments) {
      // Validate every tableId belongs to this layout
      const validTableIds = new Set(
        (await tx.table.findMany({ where: { layoutId }, select: { id: true } })).map(t => t.id),
      );
      const validSectionIds = new Set(
        (await tx.section.findMany({ where: { layoutId }, select: { id: true } })).map(s => s.id),
      );
      for (const [tableId, sectionId] of Object.entries(parsed.data.tableAssignments)) {
        if (!validTableIds.has(tableId)) continue;
        if (sectionId !== null && !validSectionIds.has(sectionId)) continue;
        await tx.table.update({ where: { id: tableId }, data: { sectionId } });
      }
    }

    return tx.section.findMany({
      where: { layoutId },
      orderBy: { label: "asc" },
      include: { _count: { select: { tables: true } } },
    });
  });

  return NextResponse.json({ sections: result });
}
