"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { signIn } from "next-auth/react";

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      email: String(fd.get("email") ?? "").toLowerCase().trim(),
      password: String(fd.get("password") ?? ""),
    };

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoading(false);
      toast.error(data?.error ?? "Could not create account.");
      return;
    }
    const r = await signIn("credentials", { email: payload.email, password: payload.password, redirect: false });
    setLoading(false);
    if (r?.error) {
      toast.error("Account created but couldn't sign in. Try logging in.");
      router.push("/login");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex-1 flex items-center justify-center p-5">
      <div className="card w-full max-w-md p-7">
        <Link href="/" className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">← Back</Link>
        <h1 className="text-2xl font-bold mt-4 mb-1">Create your account</h1>
        <p className="text-sm text-[var(--color-fg-muted)] mb-6">Start running events in a few clicks.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" name="name" type="text" required className="input" placeholder="Daisy Planner" />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" required autoComplete="email" className="input" placeholder="you@example.com" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="input" placeholder="At least 8 characters" />
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary w-full h-11">
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="text-sm text-[var(--color-fg-muted)] text-center mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-[var(--color-fg)] underline">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
