import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";
import { nanoid } from "@/lib/utils";

const createSchema = z.object({
  name: z.string().min(1).max(120),
  venueName: z.string().max(120).nullable().optional(),
  date: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { name, venueName, date } = parsed.data;

  let publicSlug = nanoid(8);
  for (let i = 0; i < 5; i++) {
    const taken = await db.event.findUnique({ where: { publicSlug } });
    if (!taken) break;
    publicSlug = nanoid(8);
  }

  const event = await db.event.create({
    data: {
      hostUserId: userId,
      name,
      venueName: venueName || null,
      date: date ? new Date(date) : null,
      publicSlug,
    },
    select: { id: true, publicSlug: true, name: true },
  });

  return NextResponse.json({ ok: true, event });
}

export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const events = await db.event.findMany({
    where: { hostUserId: userId },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, status: true, date: true, venueName: true, publicSlug: true },
  });
  return NextResponse.json({ events });
}
