import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

// QR creation now requires a location. Either:
//   - { label, scanOriginXPct, scanOriginYPct } — landmark mode
//   - { tableId } — table-bound mode (coords auto-pulled from the table)
const schema = z.object({
  label: z.string().min(1).max(40).optional(),
  scanOriginXPct: z.number().min(0).max(100).optional(),
  scanOriginYPct: z.number().min(0).max(100).optional(),
  tableId: z.string().optional(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const ev = await db.event.findUnique({
    where: { id },
    include: { layout: { include: { tables: true } } },
  });
  if (!ev || ev.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  let label: string;
  let xPct: number;
  let yPct: number;
  let boundTableId: string | null = null;

  if (parsed.data.tableId) {
    const t = ev.layout?.tables.find((t) => t.id === parsed.data.tableId);
    if (!t) return NextResponse.json({ error: "Table not found on this event's layout" }, { status: 400 });
    label = parsed.data.label?.trim() || t.label;
    xPct = t.xPct;
    yPct = t.yPct;
    boundTableId = t.id;
  } else {
    if (typeof parsed.data.scanOriginXPct !== "number" || typeof parsed.data.scanOriginYPct !== "number") {
      return NextResponse.json({ error: "Location required: provide tableId or scanOriginXPct/YPct" }, { status: 400 });
    }
    if (!parsed.data.label?.trim()) {
      return NextResponse.json({ error: "Label is required for landmark QRs" }, { status: 400 });
    }
    label = parsed.data.label.trim();
    xPct = parsed.data.scanOriginXPct;
    yPct = parsed.data.scanOriginYPct;
  }

  const qr = await db.qRCode.create({
    data: {
      eventId: id,
      label,
      scanOriginXPct: xPct,
      scanOriginYPct: yPct,
      tableId: boundTableId,
    },
  });
  return NextResponse.json({ qr });
}
