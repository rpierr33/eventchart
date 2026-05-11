import Link from "next/link";
import { auth } from "@/auth";

export default async function Home() {
  const session = await auth();
  return (
    <main className="flex-1">
      <nav className="border-b border-[var(--color-border)] bg-[var(--color-bg)]/85 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <span className="font-medium tracking-tight">eventChart</span>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <Link href="#how" className="btn btn-ghost h-9 text-[13px]">How it works</Link>
            {session?.user ? (
              <Link href="/dashboard" className="btn btn-primary h-9 text-[13px]">Open dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost h-9 text-[13px]">Sign in</Link>
                <Link href="/signup" className="btn btn-primary h-9 text-[13px]">Get started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <section className="max-w-3xl mx-auto px-6 pt-24 pb-20 text-center">
        <span className="badge badge-accent mb-7">For event planners</span>
        <h1 className="display text-[64px] sm:text-[76px] leading-[1.02] tracking-tight">
          A seating chart that<br />keeps up with you.
        </h1>
        <p className="mt-7 text-[17px] leading-relaxed text-[var(--color-fg-muted)] max-w-xl mx-auto">
          Upload your floor plan. We&apos;ll read every table on it. Guests scan a QR and see their seat circled on your actual plan — no printing, no apps, no friction.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link href={session?.user ? "/dashboard" : "/signup"} className="btn btn-primary h-12 px-7 text-[15px]">
            {session?.user ? "Open dashboard" : "Try it free"}
          </Link>
          <Link href="#how" className="btn h-12 px-6 text-[15px]">See how</Link>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6">
        <div className="hairline" />
      </div>

      <section id="how" className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="display text-[36px] sm:text-[44px] text-center mb-3">Built around the way you actually work.</h2>
        <p className="text-center text-[var(--color-fg-muted)] max-w-xl mx-auto mb-14">
          Every screen is designed for one thumb, in a dim ballroom, while you&apos;re also running the night.
        </p>
        <div className="grid md:grid-cols-3 gap-px bg-[var(--color-border)] border border-[var(--color-border)] rounded-2xl overflow-hidden">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-[var(--color-surface)] p-8">
              <div className="font-serif text-[28px] text-[var(--color-accent)] mb-3 leading-none">{f.numeral}</div>
              <h3 className="text-[15px] font-medium mb-2 tracking-tight">{f.title}</h3>
              <p className="text-[14px] leading-relaxed text-[var(--color-fg-muted)]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-24">
        <div className="card p-10 text-center">
          <h3 className="display text-[32px] mb-3">One event at a time, free.</h3>
          <p className="text-[var(--color-fg-muted)] mb-6 text-[15px]">
            Sign up, set up your first event in minutes, and run it from your phone.
          </p>
          <Link href={session?.user ? "/dashboard" : "/signup"} className="btn btn-primary h-12 px-7 text-[15px]">
            {session?.user ? "Open dashboard" : "Start free"}
          </Link>
        </div>
      </section>

      <footer className="border-t border-[var(--color-border)] py-10 text-center text-[13px] text-[var(--color-fg-faint)]">
        <span className="font-serif italic text-[var(--color-fg-muted)] text-[15px] mr-2">eventChart</span>
        · seating that keeps up
      </footer>
    </main>
  );
}

function Mark() {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--color-ink)] text-white">
      <svg viewBox="0 0 20 20" width="14" height="14" fill="none">
        <circle cx="10" cy="6" r="2.5" fill="currentColor" />
        <path d="M10 10c-2.8 0-5 2.2-5 5h10c0-2.8-2.2-5-5-5Z" fill="currentColor" />
      </svg>
    </span>
  );
}

const FEATURES = [
  {
    numeral: "I",
    title: "Upload, never redraw",
    body: "Drop your venue's PDF or photo of the floor plan. AI reads every table on it — label, capacity, position. You review and edit, you don't click.",
  },
  {
    numeral: "II",
    title: "One scan to seat",
    body: "Guests open the QR, type their last name, and see their table ringed on your actual floor plan with a one-line direction.",
  },
  {
    numeral: "III",
    title: "Live, on your phone",
    body: "Move guests, mark no-shows, approve walk-ins from a single mobile view. Updates push to the room the moment you tap.",
  },
  {
    numeral: "IV",
    title: "Plus-ones & walk-ins",
    body: "Plus-ones self-claim under their host's name. Walk-ins self-serve into open seats or queue for your approval.",
  },
  {
    numeral: "V",
    title: "Save once, reuse forever",
    body: "Same hotel four times a year? Save the floor plan as a template. Next event loads it ready to assign.",
  },
  {
    numeral: "VI",
    title: "Offline-aware",
    body: "Lookup keeps working in cellular dead zones. A printable fallback PDF is one click away as a final safety net.",
  },
];
