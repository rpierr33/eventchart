"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") ?? "").toLowerCase().trim();
    const password = String(fd.get("password") ?? "");

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("Invalid email or password.");
      return;
    }
    const next = params.get("next") ?? "/dashboard";
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" placeholder="you@example.com" />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" className="input" placeholder="••••••••" />
      </div>
      <button type="submit" disabled={loading} className="btn btn-primary w-full h-11">
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex-1 flex items-center justify-center p-5">
      <div className="card w-full max-w-md p-7">
        <Link href="/" className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">← Back</Link>
        <h1 className="text-2xl font-bold mt-4 mb-1">Welcome back</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mb-6">Sign in to manage your events.</p>
        <Suspense>
          <LoginForm />
        </Suspense>
        <p className="text-sm text-[var(--color-fg-muted)] text-center mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[var(--color-fg)] underline">Sign up</Link>
        </p>
      </div>
    </main>
  );
}
