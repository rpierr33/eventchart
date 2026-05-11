import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import EventSetupTabs from "./EventSetupTabs";
import { fmtDate } from "@/lib/utils";

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await auth();
  const userId = (session?.user as { id?: string })?.id;
  if (!userId) redirect("/login");

  const { id } = await params;
  const { tab } = await searchParams;

  const event = await db.event.findUnique({
    where: { id },
    include: {
      layout: { include: { tables: { orderBy: { label: "asc" } } } },
      guests: { orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { assignedSeat: true } },
      qrCodes: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!event || event.hostUserId !== userId) notFound();

  const templates = await db.layout.findMany({
    where: { templateOwnerId: userId, isTemplate: true },
    select: { id: true, name: true, templateName: true, sourceImageUrl: true, sourceImageWidth: true, sourceImageHeight: true, _count: { select: { tables: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="max-w-6xl mx-auto px-5 py-6">
      <Link href="/dashboard" className="text-sm text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]">← Dashboard</Link>
      <header className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{event.name}</h1>
          <p className="text-[var(--color-fg-muted)] text-sm mt-1">
            {event.venueName ? `${event.venueName} · ` : ""}{fmtDate(event.date)}
            {" · "}<span className="capitalize">{event.status.toLowerCase()}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {event.status !== "LIVE" && (
            <GoLiveButton eventId={event.id} />
          )}
          <Link href={`/dashboard/events/${event.id}/live`} className="btn btn-primary h-10">
            {event.status === "LIVE" ? "Live view" : "Preview live view"}
          </Link>
        </div>
      </header>

      <EventSetupTabs
        initialTab={tab ?? "layout"}
        event={{
          id: event.id,
          publicSlug: event.publicSlug,
          allowWalkIns: event.allowWalkIns,
          walkInMode: event.walkInMode,
          lookupPrivacy: event.lookupPrivacy,
          eventCode: event.eventCode,
          status: event.status,
          noShowAutoFlagMinutes: event.noShowAutoFlagMinutes,
        }}
        layout={event.layout ? {
          id: event.layout.id,
          name: event.layout.name,
          sourceImageUrl: event.layout.sourceImageUrl,
          sourceImageWidth: event.layout.sourceImageWidth,
          sourceImageHeight: event.layout.sourceImageHeight,
          tables: event.layout.tables.map(t => ({
            id: t.id,
            label: t.label,
            capacity: t.capacity,
            xPct: t.xPct,
            yPct: t.yPct,
            directionsText: t.directionsText,
            notes: t.notes,
          })),
        } : null}
        guests={event.guests.map(g => ({
          id: g.id,
          firstName: g.firstName,
          lastName: g.lastName,
          assignedTableId: g.assignedTableId,
          groupTag: g.groupTag,
          plusOneOfGuestId: g.plusOneOfGuestId,
          isPlusOnePlaceholder: g.isPlusOnePlaceholder,
          notes: g.notes,
        }))}
        qrCodes={event.qrCodes.map(q => ({
          id: q.id,
          label: q.label,
          scanOriginXPct: q.scanOriginXPct,
          scanOriginYPct: q.scanOriginYPct,
          qrImageUrl: q.qrImageUrl,
        }))}
        templates={templates.map(t => ({
          id: t.id,
          name: t.templateName ?? t.name,
          tableCount: t._count.tables,
          sourceImageUrl: t.sourceImageUrl,
          sourceImageWidth: t.sourceImageWidth,
          sourceImageHeight: t.sourceImageHeight,
        }))}
      />
    </main>
  );
}

function GoLiveButton({ eventId }: { eventId: string }) {
  return (
    <form action={`/api/events/${eventId}/golive`} method="POST">
      <button className="btn h-10">Mark Live</button>
    </form>
  );
}
