import { auth } from "@/auth";

export async function requireUserId(): Promise<string> {
  const session = await auth();
  const id = (session?.user as { id?: string })?.id;
  if (!id) throw new Error("UNAUTHENTICATED");
  return id;
}

export async function getUserIdOrNull(): Promise<string | null> {
  const session = await auth();
  return (session?.user as { id?: string })?.id ?? null;
}
