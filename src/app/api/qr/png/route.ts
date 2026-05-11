import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const eventSlug = url.searchParams.get("eventSlug");
  const qrId = url.searchParams.get("qr");
  if (!eventSlug) return NextResponse.json({ error: "Missing eventSlug" }, { status: 400 });

  const event = await db.event.findUnique({ where: { publicSlug: eventSlug }, select: { id: true } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let qrId2: string | null = qrId;
  if (qrId2) {
    const exists = await db.qRCode.findFirst({ where: { id: qrId2, eventId: event.id }, select: { id: true } });
    if (!exists) qrId2 = null;
  }

  const target = new URL(`/e/${eventSlug}`, req.url);
  if (qrId2) target.searchParams.set("qr", qrId2);

  const png = await QRCode.toBuffer(target.toString(), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 600,
    color: { dark: "#000000", light: "#ffffff" },
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
