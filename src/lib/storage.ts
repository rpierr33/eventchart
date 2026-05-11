import { put } from "@vercel/blob";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const HAS_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

type UploadResult = { url: string; pathname: string };

export async function uploadFile(input: {
  filename: string;
  contentType: string;
  buffer: Buffer;
  folder?: string;
}): Promise<UploadResult> {
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const id = randomUUID().slice(0, 8);
  const folder = input.folder ?? "uploads";
  const pathname = `${folder}/${id}-${safeName}`;

  if (HAS_BLOB) {
    const res = await put(pathname, input.buffer, {
      access: "public",
      contentType: input.contentType,
      addRandomSuffix: false,
    });
    return { url: res.url, pathname };
  }

  // Local fallback: write to public/uploads for dev usage
  const dir = join(process.cwd(), "public", folder);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, `${id}-${safeName}`);
  await writeFile(dest, input.buffer);
  return { url: `/${folder}/${id}-${safeName}`, pathname };
}
