import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  await db.pushSubscription.upsert({
    where: { userId_endpoint: { userId, endpoint: parsed.data.endpoint } },
    update: { p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, userAgent: parsed.data.userAgent ?? null },
    create: {
      userId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent: parsed.data.userAgent ?? null,
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const endpoint = body?.endpoint;
  if (typeof endpoint !== "string") return NextResponse.json({ error: "endpoint required" }, { status: 400 });
  await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return NextResponse.json({ ok: true });
}
