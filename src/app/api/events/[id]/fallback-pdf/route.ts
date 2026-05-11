import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth-helpers";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let userId: string;
  try { userId = await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const event = await db.event.findUnique({
    where: { id },
    include: {
      layout: { include: { tables: { orderBy: { label: "asc" } } } },
      guests: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { assignedTable: true } },
    },
  });
  if (!event || event.hostUserId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Page 1: alphabetical name → table
  const page1 = pdf.addPage([612, 792]); // letter
  const { width } = page1.getSize();
  let y = 760;
  page1.drawText(event.name, { x: 40, y, size: 22, font: fontBold, color: rgb(0, 0, 0) });
  y -= 22;
  page1.drawText(`Fallback list · ${event.venueName ?? ""}`, { x: 40, y, size: 11, font, color: rgb(0.35, 0.35, 0.35) });
  y -= 28;
  page1.drawText("Name", { x: 40, y, size: 11, font: fontBold });
  page1.drawText("Table", { x: 320, y, size: 11, font: fontBold });
  page1.drawText("Group", { x: 440, y, size: 11, font: fontBold });
  y -= 4;
  page1.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 14;

  let currentPage = page1;
  for (const g of event.guests) {
    if (y < 50) {
      currentPage = pdf.addPage([612, 792]);
      y = 760;
    }
    const name = `${g.lastName ? g.lastName + ", " : ""}${g.firstName}`;
    currentPage.drawText(name.slice(0, 50), { x: 40, y, size: 11, font });
    currentPage.drawText(g.assignedTable?.label ?? "—", { x: 320, y, size: 11, font });
    currentPage.drawText((g.groupTag ?? "").slice(0, 24), { x: 440, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 14;
  }

  // Page 2: table directory
  const dirPage = pdf.addPage([612, 792]);
  let dy = 760;
  dirPage.drawText("Tables", { x: 40, y: dy, size: 22, font: fontBold });
  dy -= 32;
  for (const t of event.layout?.tables ?? []) {
    if (dy < 60) break;
    dirPage.drawText(t.label, { x: 40, y: dy, size: 13, font: fontBold });
    dirPage.drawText(`${t.capacity} seats`, { x: 200, y: dy, size: 11, font, color: rgb(0.4, 0.4, 0.4) });
    if (t.directionsText) {
      dy -= 14;
      dirPage.drawText(t.directionsText.slice(0, 80), { x: 60, y: dy, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
    }
    const seated = event.guests.filter(g => g.assignedTableId === t.id);
    if (seated.length) {
      dy -= 14;
      const names = seated.map(g => `${g.firstName} ${g.lastName}`).join(", ");
      const wrapped = wrap(names, 100);
      for (const line of wrapped) {
        if (dy < 60) break;
        dirPage.drawText(line, { x: 60, y: dy, size: 9, font });
        dy -= 11;
      }
    }
    dy -= 18;
  }

  const bytes = await pdf.save();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${slug(event.name)}-fallback.pdf"`,
      "cache-control": "no-store",
    },
  });
}

function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of s.split(" ")) {
    if ((cur + " " + word).trim().length > max) {
      out.push(cur);
      cur = word;
    } else {
      cur = (cur + " " + word).trim();
    }
  }
  if (cur) out.push(cur);
  return out.slice(0, 8);
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50);
}
