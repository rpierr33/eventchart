import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/lib/auth-helpers";
import { getAnthropic, MODEL } from "@/lib/anthropic";

const schema = z.union([
  z.object({ text: z.string().min(1).max(80_000) }),
  z.object({
    imageBase64: z.string().min(1),
    mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  }),
]);

const SYSTEM = `You normalize messy event guest-list documents into clean JSON.

The input may be a text dump (CSV, pasted email, Word doc) or a photo of a printed/handwritten list.

Output STRICT JSON only:
{"guests": [{firstName, lastName, tableLabel?, groupTag?, notes?, plusOneOf?, isPlaceholder?, isVip?}]}

Rules:
- Names: split into firstName + lastName. If lastName unknown, leave empty.
- "Mr. and Mrs. Smith" → two records: "Mr." Smith and "Mrs." Smith.
- "John Smith +1" → John, plus a placeholder record with isPlaceholder:true and plusOneOf:"John Smith".
- "John Smith and Mary" → John Smith + Mary (plusOneOf:"John Smith", lastName:"Smith" if not stated).
- "Table 7: John, Mary, Sue" → 3 records, all with tableLabel:"Table 7".
- "T7: John" → tableLabel: "T7" (preserve exact label as written in the source).
- Section headers like "Bride's Family:" → groupTag on guests below until next header.
- Dietary/accessibility notes → notes field.
- VIP detection: set isVip:true when the source contains any of these signals:
  * Explicit prefix/suffix: "VIP", "★", "*", "Honored Guest", "Guest of Honor".
  * Titled standouts: Senator, Congressman, Congresswoman, Mayor, Governor, Judge, Reverend, Father, Rabbi, Imam, General, Admiral, Captain (military), Dr. when paired with a notable surname or context, CEO/Founder/Chair when listed in a business event header, Ambassador, Honorable, Justice, Sir, Dame, Lord, Lady, His/Her Excellency.
  * Section headers like "VIP Table", "Head Table", "Sweetheart Table" → mark every guest under that header isVip:true.
  * If the title is just "Mr." or "Mrs." alone (no further distinction), do NOT mark VIP.
  Always preserve any explicit title in the firstName (e.g., "Senator Pierre" → firstName:"Senator Pierre" or firstName:"Senator", lastName:"Pierre" — your call by context, but keep the title visible).
- Drop empty rows, "X people" counts, and any non-guest noise.
- Maximum 2000 guests.
- Do NOT invent guests. Only output what's present.

Respond with ONLY the JSON. No prose, no markdown fences.`;

export async function POST(req: Request) {
  try { await requireUserId(); } catch { return NextResponse.json({ error: "Not signed in" }, { status: 401 }); }
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "AI not configured. Set ANTHROPIC_API_KEY." }, { status: 503 });

  let content: Array<
    | { type: "text"; text: string }
    | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string } }
  >;
  if ("text" in parsed.data) {
    content = [{ type: "text", text: parsed.data.text }];
  } else {
    content = [
      { type: "image", source: { type: "base64", media_type: parsed.data.mediaType, data: parsed.data.imageBase64 } },
      { type: "text", text: "Parse this guest list into JSON. Preserve any table labels exactly as written." },
    ];
  }

  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    const textBlock = resp.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("Empty AI response");

    const json = extractJson(textBlock.text);
    if (!json || !Array.isArray(json.guests)) throw new Error("AI returned no guests array");

    const cleaned = (json.guests as Array<Record<string, unknown>>).map((g) => ({
      firstName: String(g.firstName ?? "").trim(),
      lastName: String(g.lastName ?? "").trim(),
      tableLabel: g.tableLabel ? String(g.tableLabel).trim() : null,
      groupTag: g.groupTag ? String(g.groupTag).trim() : null,
      notes: g.notes ? String(g.notes).trim() : null,
      plusOneOf: g.plusOneOf ? String(g.plusOneOf).trim() : null,
      isPlaceholder: !!g.isPlaceholder,
      isVip: !!g.isVip,
    })).filter((g) => g.firstName || g.lastName);

    return NextResponse.json({ guests: cleaned });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI parse failed" }, { status: 500 });
  }
}

function extractJson(text: string): { guests?: unknown[] } | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fence ? fence[1] : text).trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) return null;
  try { return JSON.parse(raw.slice(first, last + 1)); } catch { return null; }
}
