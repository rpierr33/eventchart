import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth-helpers";
import { uploadFile } from "@/lib/storage";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);

export async function POST(req: Request) {
  try {
    await requireUserId();
  } catch {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Bad form data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "File > 10MB" }, { status: 413 });
  if (!ALLOWED.has(file.type)) return NextResponse.json({ error: `Unsupported type ${file.type}` }, { status: 415 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await uploadFile({
    filename: file.name,
    contentType: file.type,
    buffer,
    folder: "layouts",
  });
  return NextResponse.json({ ok: true, url: result.url });
}
