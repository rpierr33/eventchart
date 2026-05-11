import Link from "next/link";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/utils";

export default async function DashboardPage() {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) return null;

  const [events, templates] = await Promise.all([
    db.event.findMany({
      where: { hostUserId: userId },
      include: {
        _count: { select: { guests: true, qrCodes: true } },
        layout: { include: { _count: { select: { tables: true } } } },
      },
      orderBy: [{ status: "asc" }, { date: "desc" }, { createdAt: "desc" }],
    }),
    db.layout.findMany({
      where: { templateOwnerId: userId, isTemplate: true },
      include: { _count: { select: { tables: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const upcoming = events.filter(e => e.status !== "ENDED");
  const past = events.filter(e => e.status === "ENDED");

  return (
    <main className="max-w-6xl mx-auto px-6 py-10">
      <header className="flex items-end justify-between mb-10 flex-wrap gap-4">
        <div>
          <h1 className="display text-[44px] leading-none mb-1">Your events</h1>
          <p className="text-[14px] text-[var(--color-fg-muted)]">Drafts, live tonight, all in one place.</p>
        </div>
        <Link href="/dashboard/events/new" className="btn btn-primary h-11 text-[14px]">
          New event
        </Link>
      </header>

      <section className="mb-12">
        <SectionLabel>Upcoming & drafts</SectionLabel>
        {upcoming.length === 0 ? (
          <div className="card p-14 text-center">
            <div className="font-serif text-[36px] text-[var(--color-accent)] mb-3 leading-none">I</div>
            <h3 className="text-[18px] font-medium mb-2">No events yet</h3>
            <p className="text-[14px] text-[var(--color-fg-muted)] mb-6 max-w-sm mx-auto">
              Set up your first event in a few minutes. You&apos;ll be done before you finish your coffee.
            </p>
            <Link href="/dashboard/events/new" className="btn btn-primary h-11">Create your first event</Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcoming.map(e => (
              <Link
                key={e.id}
                href={`/dashboard/events/${e.id}`}
                className="card p-5 group transition-all hover:shadow-[0_4px_20px_rgba(20,18,14,0.06)] hover:-translate-y-px"
              >
                <div className="flex items-center justify-between mb-3">
                  <StatusBadge status={e.status} />
                  <span className="text-[12px] text-[var(--color-fg-faint)]">{fmtDate(e.date)}</span>
                </div>
                <h3 className="font-medium text-[17px] mb-1 tracking-tight truncate">{e.name}</h3>
                <p className="text-[13px] text-[var(--color-fg-muted)] truncate">{e.venueName ?? "—"}</p>
                <div className="flex items-center gap-4 text-[12px] text-[var(--color-fg-faint)] mt-5 pt-4 border-t border-[var(--color-border-soft)]">
                  <Stat label="guests" value={e._count.guests} />
                  <Stat label="tables" value={e.layout?._count.tables ?? 0} />
                  <Stat label="QR" value={e._count.qrCodes} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {templates.length > 0 && (
        <section className="mb-12">
          <SectionLabel>Layout templates</SectionLabel>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => (
              <div key={t.id} className="card p-5">
                <h3 className="font-medium tracking-tight truncate">{t.templateName ?? t.name}</h3>
                <p className="text-[12px] text-[var(--color-fg-muted)] mt-1">{t._count.tables} tables</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <SectionLabel>Past events</SectionLabel>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {past.map(e => (
              <Link
                key={e.id}
                href={`/dashboard/events/${e.id}`}
                className="card p-5 opacity-75 hover:opacity-100 transition-opacity"
              >
                <div className="flex items-center justify-between mb-3">
                  <StatusBadge status={e.status} />
                  <span className="text-[12px] text-[var(--color-fg-faint)]">{fmtDate(e.date)}</span>
                </div>
                <h3 className="font-medium tracking-tight truncate">{e.name}</h3>
                <p className="text-[13px] text-[var(--color-fg-muted)] truncate">{e.venueName ?? "—"}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[var(--color-fg)] font-medium tabular-nums">{value}</span>
      <span>{label}</span>
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-medium text-[var(--color-fg-muted)] uppercase tracking-[0.08em] mb-4">
      {children}
    </h2>
  );
}

function StatusBadge({ status }: { status: "DRAFT" | "LIVE" | "ENDED" }) {
  if (status === "LIVE") return (
    <span className="badge badge-green">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] animate-pulse" />
      Live
    </span>
  );
  if (status === "ENDED") return <span className="badge badge-gray">Ended</span>;
  return <span className="badge badge-yellow">Draft</span>;
}
