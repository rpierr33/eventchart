"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

export default function NewEventPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      venueName: String(fd.get("venueName") ?? "").trim() || null,
      date: String(fd.get("date") ?? "") || null,
    };
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast.error(data?.error ?? "Could not create event.");
      return;
    }
    toast.success("Event created.");
    router.push(`/dashboard/events/${data.event.id}`);
  }

  return (
    <main className="max-w-xl mx-auto px-5 py-8">
      <Link href="/dashboard" className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">← Dashboard</Link>
      <h1 className="text-3xl font-bold mt-3 mb-1">New event</h1>
      <p className="text-[var(--color-fg-muted)] mb-7">Start with the basics. You can fill in everything else next.</p>

      <form onSubmit={onSubmit} className="card p-6 space-y-4">
        <div>
          <label htmlFor="name" className="label">Event name</label>
          <input id="name" name="name" type="text" required maxLength={120} className="input" placeholder="Smith Wedding · Sept 14" />
        </div>
        <div>
          <label htmlFor="venueName" className="label">Venue</label>
          <input id="venueName" name="venueName" type="text" maxLength={120} className="input" placeholder="Four Seasons Ballroom" />
        </div>
        <div>
          <label htmlFor="date" className="label">Date</label>
          <input id="date" name="date" type="date" className="input" />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button type="submit" disabled={loading} className="btn btn-primary flex-1 h-11">
            {loading ? "Creating…" : "Create event"}
          </button>
          <Link href="/dashboard" className="btn h-11">Cancel</Link>
        </div>
      </form>
    </main>
  );
}
