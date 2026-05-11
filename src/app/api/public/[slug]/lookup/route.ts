import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const schema = z.object({ lastName: z.string().min(1).max(80) });

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({
    where: { publicSlug: slug },
    select: { id: true, status: true },
  });
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  const ln = parsed.data.lastName.trim().toLowerCase();
  const guests = await db.guest.findMany({
    where: {
      eventId: event.id,
      lastName: { equals: ln, mode: "insensitive" },
    },
    include: { assignedTable: true },
    orderBy: { firstName: "asc" },
  });

  if (guests.length === 0) return NextResponse.json({ kind: "none" });

  const shaped = guests.map(g => ({
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    tableId: g.assignedTable?.id ?? null,
    tableLabel: g.assignedTable?.label ?? null,
    tableXPct: g.assignedTable?.xPct ?? null,
    tableYPct: g.assignedTable?.yPct ?? null,
    tableDirections: g.assignedTable?.directionsText ?? null,
  }));

  if (shaped.length === 1) return NextResponse.json({ kind: "single", match: shaped[0] });
  return NextResponse.json({ kind: "matches", matches: shaped });
}
