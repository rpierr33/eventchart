import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth-helpers";
import { getAnthropic, MODEL } from "@/lib/anthropic";

const schema = z.object({
  imageBase64: z.string().min(1),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
});

const SYSTEM = `You analyze event venue floor plans (image) and identify tables, landmarks, and sections.

Output STRICT JSON only:
{
  "tables": [
    {
      "label": "Table 1",
      "shape": "round" | "rectangle" | "square" | "oval",
      "capacityEstimate": 8,
      "xPct": 45.2,
      "yPct": 30.1,
      "sectionLabel": "Bride's Side"   // optional — match a section.label if the table sits inside one
    }
  ],
  "landmarks": [
    { "label": "Entrance" | "Bar" | "Stage" | "Restrooms" | "Dance Floor", "xPct": 50, "yPct": 90 }
  ],
  "sections": [
    {
      "label": "Bride's Side" | "Groom's Side" | "VIP" | "Family" | "Friends" | "Kids" | "Head Table" | etc.,
      "xPct": 25,    // centroid of the section
      "yPct": 50,
      "polygon": [{"x":10,"y":20},{"x":40,"y":20},{"x":40,"y":80},{"x":10,"y":80}]  // optional, 3-12 vertices
    }
  ]
}

Rules:
- xPct/yPct are percentages of the image width/height (0..100), pointing to the visual CENTER of each item.
- capacityEstimate based on shape/size (round 60in = 8 seats, round 72in = 10-12, rectangle for 6-10, etc.). Use 8 if unsure.
- Number tables 1..N if no labels visible.
- Skip chairs, props, and decor — only seating tables.
- Include obvious wayfinding landmarks if visible (entrance, bar, stage, restrooms, dance floor).
- SECTIONS are logical groupings: if the plan shows labels like "Bride's Side", "Groom's Side", "VIP", "Family", "Kids", "Head Table", or visible dividers/zones, return them. For each table, set sectionLabel to the matching section's label so they link up. Polygon is optional — if you can outline the section's boundary (3-12 vertices clockwise), include it; otherwise omit and we'll derive from member-table positions.
- If the plan has NO visible sections, return sections: [].
- Do NOT include prose. JSON only.`;

export async function POST(req: Request) {
  try { await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "AI not configured. Set ANTHROPIC_API_KEY." }, { status: 503 });

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: { type: "base64", media_type: parsed.data.mediaType, data: parsed.data.imageBase64 },
        }, {
          type: "text",
          text: "Identify every seating table on this floor plan and return JSON.",
        }],
      }],
    });
    const block = resp.content.find(b => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No content");
    const data = extractJson(block.text);
    if (!data || !Array.isArray(data.tables)) throw new Error("AI returned no tables array");
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI parse failed" }, { status: 500 });
  }
}

function extractJson(text: string): { tables?: unknown[]; landmarks?: unknown[]; sections?: unknown[] } | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  try { return JSON.parse(raw); } catch { /* fallback */ }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(raw.slice(first, last + 1)); } catch { return null; }
}
