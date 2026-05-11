import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const eventSlug = url.searchParams.get("eventSlug");
  const qrId = url.searchParams.get("qr");
  if (!eventSlug) return NextResponse.json({ error: "Missing eventSlug" }, { status: 400 });

  const event = await db.event.findUnique({
    where: { publicSlug: eventSlug },
    include: { qrCodes: qrId ? { where: { id: qrId } } : true },
  });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const qr = qrId ? event.qrCodes[0] : event.qrCodes[0];
  if (!qr) return NextResponse.json({ error: "No QR" }, { status: 404 });

  const target = new URL(`/e/${eventSlug}`, req.url);
  target.searchParams.set("qr", qr.id);
  const dataUrl = await QRCode.toDataURL(target.toString(), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 1000,
    color: { dark: "#000000", light: "#ffffff" },
  });

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${event.name} · ${qr.label}</title>
<style>
  @page { size: letter; margin: 0.6in; }
  * { box-sizing: border-box; }
  body { font: 14px -apple-system, system-ui, sans-serif; color: #111; margin: 0; padding: 20px; text-align: center; }
  .frame { max-width: 6in; margin: 0 auto; border: 3px solid #111; border-radius: 12px; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 28px; }
  h2 { margin: 4px 0 24px; font-weight: 500; color: #444; }
  img { width: 100%; max-width: 4in; height: auto; display: block; margin: 0 auto; }
  .label { margin-top: 24px; font-size: 18px; font-weight: 600; }
  .hint { margin-top: 4px; color: #666; }
  .url { margin-top: 16px; font-family: ui-monospace, monospace; font-size: 11px; color: #888; word-break: break-all; }
  button { margin-top: 24px; padding: 10px 20px; font: inherit; border-radius: 6px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
  @media print { button { display: none; } body { padding: 0; } .frame { border: 2px solid #111; } }
</style>
</head><body>
<div class="frame">
  <h1>${escapeHtml(event.name)}</h1>
  <h2>Scan to find your seat</h2>
  <img src="${dataUrl}" alt="QR code" />
  <div class="label">${escapeHtml(qr.label)}</div>
  <div class="hint">Point your camera at the code, then enter your last name.</div>
  <div class="url">${target.toString()}</div>
  <button onclick="window.print()">Print</button>
</div>
<script>setTimeout(() => { try { window.print() } catch {} }, 600);</script>
</body></html>`;

  return new NextResponse(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
