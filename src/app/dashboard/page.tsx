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
    <main className="max-w-6xl mx-auto px-5 py-8">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your events</h1>
          <p className="text-[var(--color-fg-muted)] text-sm mt-1">Drafts, live tonight, all in one place.</p>
        </div>
        <Link href="/dashboard/events/new" className="btn btn-primary h-11">
          + New event
        </Link>
      </header>

      <section className="mb-10">
        <h2 className="text-sm font-medium text-[var(--color-fg-muted)] uppercase tracking-wider mb-3">
          Upcoming & drafts ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <h3 className="font-semibold text-lg mb-1">No events yet</h3>
            <p className="text-[var(--color-fg-muted)] text-sm mb-6">Get a planner-grade seating chart up in a few minutes.</p>
            <Link href="/dashboard/events/new" className="btn btn-primary">Create your first event</Link>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {upcoming.map(e => (
              <Link key={e.id} href={`/dashboard/events/${e.id}`} className="card p-5 hover:border-[var(--color-brand)] transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <StatusBadge status={e.status} />
                  <span className="text-xs text-[var(--color-fg-faint)]">{fmtDate(e.date)}</span>
                </div>
                <h3 className="font-semibold text-lg mb-1 truncate">{e.name}</h3>
                <p className="text-sm text-[var(--color-fg-muted)] truncate">{e.venueName ?? "No venue set"}</p>
                <div className="flex items-center gap-3 text-xs text-[var(--color-fg-faint)] mt-4">
                  <span>👥 {e._count.guests} guests</span>
                  <span>📍 {e.layout?._count.tables ?? 0} tables</span>
                  <span>📲 {e._count.qrCodes} QR</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {templates.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-medium text-[var(--color-fg-muted)] uppercase tracking-wider mb-3">
            Layout templates ({templates.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(t => (
              <div key={t.id} className="card p-5">
                <h3 className="font-semibold mb-1 truncate">{t.templateName ?? t.name}</h3>
                <p className="text-xs text-[var(--color-fg-muted)]">{t._count.tables} tables</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-[var(--color-fg-muted)] uppercase tracking-wider mb-3">
            Past events ({past.length})
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {past.map(e => (
              <Link key={e.id} href={`/dashboard/events/${e.id}`} className="card p-5 opacity-70 hover:opacity-100 transition-opacity">
                <div className="flex items-center justify-between mb-3">
                  <StatusBadge status={e.status} />
                  <span className="text-xs text-[var(--color-fg-faint)]">{fmtDate(e.date)}</span>
                </div>
                <h3 className="font-semibold mb-1 truncate">{e.name}</h3>
                <p className="text-sm text-[var(--color-fg-muted)] truncate">{e.venueName ?? "—"}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: "DRAFT" | "LIVE" | "ENDED" }) {
  if (status === "LIVE") return <span className="badge badge-green">● Live</span>;
  if (status === "ENDED") return <span className="badge badge-gray">Ended</span>;
  return <span className="badge badge-yellow">Draft</span>;
}
