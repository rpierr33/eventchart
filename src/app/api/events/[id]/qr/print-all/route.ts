import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

export const runtime = "nodejs";
export const maxDuration = 60;

// QR size presets (in inches edge length on the printed page)
const SIZES = {
  large:  6.0,   // full-page sign
  medium: 4.0,   // default — standing card
  small:  2.0,   // table-tent friendly
  tile:   0.75,  // sticker / luggage tag
} as const;
type SizeKey = keyof typeof SIZES;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const event = await db.event.findUnique({
    where: { id },
    include: {
      qrCodes: { orderBy: [{ tableId: "asc" }, { label: "asc" }] },
      layout: { include: { tables: true } },
    },
  });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (event.qrCodes.length === 0) return NextResponse.json({ error: "No QR codes to print" }, { status: 400 });

  const url = new URL(req.url);
  const sizeParam = (url.searchParams.get("size") ?? "medium").toLowerCase();
  const size: SizeKey = (Object.keys(SIZES) as SizeKey[]).includes(sizeParam as SizeKey) ? (sizeParam as SizeKey) : "medium";
  const qrEdgeIn = SIZES[size];
  const tilesPerPage = size === "tile" ? 12 : 1; // 4×3 grid of tile-size, full page for the rest

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // US Letter portrait: 612 × 792 pt (8.5" × 11"). 72 pt = 1 inch.
  const pageW = 612;
  const pageH = 792;
  const margin = 36;

  // Pre-build origin URLs and QR PNGs in one pass so we don't re-render per page
  const items = await Promise.all(event.qrCodes.map(async (qr) => {
    const target = new URL(`/e/${event.publicSlug}?qr=${qr.id}`, req.url);
    const png = await QRCode.toBuffer(target.toString(), {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 1000,
      color: { dark: "#000000", light: "#ffffff" },
    });
    const boundTable = qr.tableId ? event.layout?.tables.find(t => t.id === qr.tableId) : null;
    return {
      label: qr.label,
      kind: qr.tableId ? "Table" : "Landmark",
      capacity: boundTable?.capacity,
      url: target.toString(),
      pngBytes: new Uint8Array(png),
    };
  }));

  if (tilesPerPage === 1) {
    for (const item of items) {
      const page = pdf.addPage([pageW, pageH]);
      // Title block
      page.drawText(event.name, { x: margin, y: pageH - margin - 18, size: 20, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
      page.drawText("Scan to find your seat", { x: margin, y: pageH - margin - 36, size: 11, font, color: rgb(0.4, 0.4, 0.4) });

      // Large label
      const labelText = item.label;
      page.drawText(labelText, { x: margin, y: pageH - margin - 80, size: 36, font: fontBold, color: rgb(0.05, 0.05, 0.05) });
      if (item.kind === "Table" && item.capacity) {
        page.drawText(`${item.capacity} seats`, { x: margin, y: pageH - margin - 100, size: 11, font, color: rgb(0.5, 0.5, 0.5) });
      } else if (item.kind === "Landmark") {
        page.drawText("Landmark", { x: margin, y: pageH - margin - 100, size: 11, font, color: rgb(0.5, 0.5, 0.5) });
      }

      // QR
      const qrPx = qrEdgeIn * 72;
      const qrImage = await pdf.embedPng(item.pngBytes);
      page.drawImage(qrImage, {
        x: (pageW - qrPx) / 2,
        y: (pageH - qrPx) / 2 - 30,
        width: qrPx,
        height: qrPx,
      });

      // URL footer (tiny mono fallback for accessibility)
      page.drawText(item.url, {
        x: margin,
        y: margin + 30,
        size: 8,
        font,
        color: rgb(0.55, 0.55, 0.55),
      });
      page.drawText("Point your camera at the code. Type your last name.", {
        x: margin,
        y: margin + 14,
        size: 9,
        font,
        color: rgb(0.4, 0.4, 0.4),
      });
    }
  } else {
    // Tile grid — 3 columns × 4 rows = 12 per page. Useful for table-tent stickers.
    const cols = 3;
    const rows = 4;
    const cellW = (pageW - 2 * margin) / cols;
    const cellH = (pageH - 2 * margin) / rows;
    const qrPx = Math.min(cellW, cellH) * 0.62;

    for (let i = 0; i < items.length; i += cols * rows) {
      const page = pdf.addPage([pageW, pageH]);
      page.drawText(event.name, { x: margin, y: pageH - margin + 6, size: 11, font: fontBold });
      const batch = items.slice(i, i + cols * rows);
      for (let idx = 0; idx < batch.length; idx++) {
        const item = batch[idx];
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const cellX = margin + col * cellW;
        const cellY = pageH - margin - (row + 1) * cellH;
        const img = await pdf.embedPng(item.pngBytes);
        page.drawImage(img, {
          x: cellX + (cellW - qrPx) / 2,
          y: cellY + cellH - qrPx - 18,
          width: qrPx,
          height: qrPx,
        });
        page.drawText(item.label, {
          x: cellX + 4,
          y: cellY + 8,
          size: 11,
          font: fontBold,
        });
      }
    }
  }

  const bytes = await pdf.save();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${slug(event.name)}-qrs-${size}.pdf"`,
      "cache-control": "no-store",
    },
  });
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
}
