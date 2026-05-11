"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { signIn } from "@/auth";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(80),
});

export async function signupAction(formData: FormData) {
  const parsed = signupSchema.safeParse({
    email: String(formData.get("email") ?? "").toLowerCase().trim(),
    password: String(formData.get("password") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { email, password, name } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "An account with that email already exists." };

  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.create({
    data: { email, name, passwordHash },
  });

  await signIn("credentials", { email, password, redirect: false });
  return { ok: true };
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Email and password required." };
  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid credentials." };
  }
}
