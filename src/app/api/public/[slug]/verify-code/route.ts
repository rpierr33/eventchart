import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const schema = z.object({ code: z.string().regex(/^\d{4}$/) });

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await db.event.findUnique({ where: { publicSlug: slug }, select: { lookupPrivacy: true, eventCode: true } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  if (event.lookupPrivacy !== "CODE_PROTECTED" || !event.eventCode) {
    return NextResponse.json({ ok: true });
  }
  const ok = event.eventCode === parsed.data.code;
  return NextResponse.json({ ok });
}
