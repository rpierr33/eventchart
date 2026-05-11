import Link from "next/link";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  return (
    <main className="flex-1">
      <nav className="border-b border-[var(--color-border)]">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link href="/" className="font-bold text-lg tracking-tight flex items-center gap-2">
            <span className="inline-block w-7 h-7 rounded-md bg-[var(--color-brand)]" />
            eventChart
          </Link>
          <div className="flex items-center gap-3">
            {session?.user ? (
              <Link href="/dashboard" className="btn btn-primary">Dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost">Sign in</Link>
                <Link href="/signup" className="btn btn-primary">Get started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="max-w-5xl mx-auto px-5 pt-24 pb-16 text-center">
        <p className="badge badge-blue mb-6">For event planners on their feet</p>
        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-tight">
          The seating chart that<br />updates in real time.
        </h1>
        <p className="mt-6 text-lg text-[var(--color-fg-muted)] max-w-2xl mx-auto">
          Upload a floor plan. Drop pins. Generate a QR. Your guests scan, see their table,
          and walk straight there. You move guests, mark no-shows, and approve walk-ins
          from your phone — one thumb, dim ballroom, glass of champagne.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link href={session?.user ? "/dashboard" : "/signup"} className="btn btn-primary h-12 px-6 text-base">
            {session?.user ? "Open dashboard" : "Create your first event"}
          </Link>
          <a href="#how" className="btn h-12 px-6 text-base">How it works</a>
        </div>
      </section>

      <section id="how" className="max-w-6xl mx-auto px-5 py-16">
        <h2 className="text-2xl font-bold mb-10 text-center">Built for the planner who can&apos;t stop moving</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-[var(--color-fg-muted)]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)] py-8 text-center text-sm text-[var(--color-fg-faint)]">
        eventChart · seating that keeps up
      </footer>
    </main>
  );
}

const FEATURES = [
  { icon: "📐", title: "Upload, don't redraw", body: "Drop your venue's floor-plan PDF or image. Pin tables on top of the real layout — you keep the original, the pins are repositionable." },
  { icon: "📱", title: "One scan to seat", body: "Guests scan a QR, type their last name, and see their table circled on the floor plan with a 'you are here' anchor and one-line directions." },
  { icon: "👯", title: "Plus-ones & walk-ins", body: "Plus-ones can self-claim under their host's name. Walk-ins self-serve into open seats, with optional host approval." },
  { icon: "⚡", title: "Live & realtime", body: "When you move a guest, their next scan shows the new table. No reprinting. The room's count, check-ins, and no-shows update on your phone live." },
  { icon: "🔁", title: "Templates", body: "Save any layout as a template. Run the same ballroom four times a year? Do the floor plan once." },
  { icon: "🛡️", title: "Privacy + offline", body: "Public lookup or 4-digit code gate. Works on bad signal — the lookup page caches the event for offline scan-and-find." },
];
