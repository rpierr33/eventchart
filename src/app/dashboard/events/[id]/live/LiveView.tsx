"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { fmtDateTime } from "@/lib/utils";
import PushOptIn from "@/components/PushOptIn";

type TableT = { id: string; label: string; capacity: number; xPct: number; yPct: number; directionsText: string | null };
type GuestT = {
  id: string;
  firstName: string;
  lastName: string;
  assignedTableId: string | null;
  groupTag: string | null;
  checkedInAt: string | null;
  isWalkIn: boolean;
  noShowFlaggedAt: string | null;
  plusOneOfGuestId: string | null;
  isPlusOnePlaceholder: boolean;
  notes: string | null;
};
type WalkInT = { id: string; firstName: string; lastName: string; status: string; createdAt: string };
type StateT = {
  event: { id: string; name: string; venueName: string | null; status: "DRAFT" | "LIVE" | "ENDED"; publicSlug: string; startsAt: string | null; allowWalkIns: boolean; walkInMode: "AUTO_SEAT" | "REQUIRE_HOST_APPROVAL"; noShowAutoFlagMinutes: number };
  layout: null | { id: string; sourceImageUrl: string; sourceImageWidth: number; sourceImageHeight: number; tables: TableT[] };
  guests: GuestT[];
  qrCodes: { id: string; label: string; scanOriginXPct: number | null; scanOriginYPct: number | null }[];
  pendingWalkIns: WalkInT[];
  stats: { total: number; checkedIn: number; walkIns: number; noShows: number };
};

export default function LiveView(props: { eventId: string; eventName: string; publicSlug: string; initialStatus: "DRAFT" | "LIVE" | "ENDED" }) {
  const { eventId, publicSlug } = props;
  const [state, setState] = useState<StateT | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [showNoShow, setShowNoShow] = useState(false);
  const [reassigning, setReassigning] = useState<GuestT | null>(null);
  const [walkInApprove, setWalkInApprove] = useState<WalkInT | null>(null);
  const lastPendingCount = useRef(0);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/state`);
    if (!res.ok) return;
    const data = await res.json();
    setState(data);
  }, [eventId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll every 4s as the safety net
  useEffect(() => {
    const i = setInterval(refresh, 4000);
    return () => clearInterval(i);
  }, [refresh]);

  // SSE for instant updates
  useEffect(() => {
    const es = new EventSource(`/api/events/${eventId}/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (["checkin", "walkin-seated", "walkin-pending", "plusone", "guest-moved"].includes(data.type)) {
          refresh();
        }
      } catch { /* */ }
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [eventId, refresh]);

  // Notify on new walk-in
  useEffect(() => {
    if (!state) return;
    if (state.pendingWalkIns.length > lastPendingCount.current) {
      const newOnes = state.pendingWalkIns.length - lastPendingCount.current;
      toast(`${newOnes} new walk-in${newOnes !== 1 ? "s" : ""} need${newOnes === 1 ? "s" : ""} approval`);
    }
    lastPendingCount.current = state.pendingWalkIns.length;
  }, [state]);

  const openSeats = useMemo(() => {
    if (!state?.layout) return 0;
    let count = 0;
    for (const t of state.layout.tables) {
      const seated = state.guests.filter(g => g.assignedTableId === t.id).length;
      count += Math.max(0, t.capacity - seated);
    }
    return count;
  }, [state]);

  if (!state) {
    return <div className="min-h-screen flex items-center justify-center text-[var(--color-fg-muted)]">Loading live view…</div>;
  }

  const { event, layout, guests, pendingWalkIns, stats } = state;
  const selectedTableData = selectedTable && layout ? layout.tables.find(t => t.id === selectedTable) ?? null : null;
  const selectedTableGuests = selectedTable ? guests.filter(g => g.assignedTableId === selectedTable) : [];

  function pinClass(t: TableT) {
    const tableGuests = guests.filter(g => g.assignedTableId === t.id);
    const checkedIn = tableGuests.filter(g => g.checkedInAt).length;
    const total = tableGuests.length;
    const flagged = tableGuests.some(g => g.noShowFlaggedAt);
    const walkIn = tableGuests.some(g => g.isWalkIn);
    if (total === 0) return "pin-gray";
    if (flagged) return "pin-red";
    if (checkedIn === total) return "pin-green";
    if (walkIn) return "pin-blue";
    return "pin-yellow";
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--color-border)] px-4 py-3 sticky top-0 bg-[var(--color-bg)]/95 backdrop-blur z-20">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/dashboard/events/${event.id}`} className="text-sm text-[var(--color-fg-muted)]">← Setup</Link>
          <div className="flex items-center gap-2 text-sm">
            <PushOptIn />
            <StatusPill status={event.status} />
            <a href={`/e/${publicSlug}`} target="_blank" rel="noreferrer" className="badge badge-blue">Guest lookup ↗</a>
          </div>
        </div>
        <h1 className="text-xl font-bold mt-2">{event.name}</h1>
      </header>

      <div className="px-4 py-3 grid grid-cols-4 gap-2 sticky top-[88px] bg-[var(--color-bg)]/95 backdrop-blur z-10 border-b border-[var(--color-border)]">
        <StatCard label="Checked in" value={`${stats.checkedIn}/${stats.total}`} accent="green" />
        <StatCard label="Walk-ins" value={`${stats.walkIns}`} accent="blue" />
        <StatCard label="No-shows" value={`${stats.noShows}`} accent="red" />
        <StatCard label="Open seats" value={`${openSeats}`} accent="gray" />
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-[var(--color-border)]">
        <button onClick={() => setShowSearch(true)} className="btn h-10 text-sm">🔍 Find guest</button>
        <button onClick={() => setShowMove(true)} className="btn h-10 text-sm">↔ Move guest</button>
        <button onClick={() => setShowNoShow(true)} className="btn h-10 text-sm">⏱ Mark no-show</button>
        <button onClick={() => setShowWalkIn(true)} className="btn h-10 text-sm">+ Walk-in</button>
        {pendingWalkIns.length > 0 && (
          <button onClick={() => setWalkInApprove(pendingWalkIns[0])} className="btn btn-primary h-10 text-sm relative">
            Approve walk-ins
            <span className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-white text-[var(--color-brand)] text-xs font-bold">{pendingWalkIns.length}</span>
          </button>
        )}
        <div className="flex-1" />
        {event.status !== "ENDED" && (
          <form action={`/api/events/${event.id}/end`} method="POST">
            <button className="btn btn-danger h-10 text-sm">End event</button>
          </form>
        )}
      </div>

      {!layout ? (
        <div className="p-10 text-center">
          <p className="text-[var(--color-fg-muted)]">No layout yet — go back to setup.</p>
        </div>
      ) : (
        <div className="p-4">
          <div className="card overflow-hidden">
            <div className="relative bg-black select-none" style={{ paddingTop: `${(layout.sourceImageHeight / layout.sourceImageWidth) * 100}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={layout.sourceImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
              {layout.tables.map(t => (
                <button
                  key={t.id}
                  className={`pin ${pinClass(t)} ${selectedTable === t.id ? "pin-selected" : ""}`}
                  style={{ left: `${t.xPct}%`, top: `${t.yPct}%` }}
                  onClick={() => setSelectedTable(t.id)}
                  title={t.label}
                >
                  {t.label.match(/\d+/)?.[0] ?? "•"}
                </button>
              ))}
            </div>
            <div className="p-3 text-xs text-[var(--color-fg-muted)] flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#2ecf91]" /> all in</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#ffb547]" /> some left</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#ff5a72]" /> no-show flagged</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#4aa3ff]" /> walk-in</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-[#5a6175]" /> empty</span>
            </div>
          </div>
        </div>
      )}

      {selectedTableData && (
        <TablePanel
          table={selectedTableData}
          guests={selectedTableGuests}
          onClose={() => setSelectedTable(null)}
          onReassign={(g) => setReassigning(g)}
          onMarkNoShow={async (g) => {
            await fetch(`/api/events/${eventId}/guests/${g.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({}),
            });
            await fetch(`/api/events/${eventId}/guests/${g.id}/noshow`, { method: "POST" });
            refresh();
          }}
          onCheckIn={async (g) => {
            await fetch(`/api/public/${publicSlug}/checkin`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ guestId: g.id }),
            });
            refresh();
          }}
          onUncheckIn={async (g) => {
            await fetch(`/api/events/${eventId}/guests/${g.id}/uncheckin`, { method: "POST" });
            refresh();
          }}
        />
      )}

      {showSearch && (
        <SearchModal
          guests={guests}
          tables={layout?.tables ?? []}
          onClose={() => setShowSearch(false)}
          onPickGuest={(g) => { setShowSearch(false); setReassigning(g); }}
        />
      )}
      {showMove && (
        <SearchModal
          title="Move which guest?"
          guests={guests}
          tables={layout?.tables ?? []}
          onClose={() => setShowMove(false)}
          onPickGuest={(g) => { setShowMove(false); setReassigning(g); }}
        />
      )}
      {showNoShow && (
        <SearchModal
          title="Mark which guest as no-show?"
          guests={guests.filter(g => !g.checkedInAt && !g.noShowFlaggedAt)}
          tables={layout?.tables ?? []}
          onClose={() => setShowNoShow(false)}
          onPickGuest={async (g) => {
            setShowNoShow(false);
            await fetch(`/api/events/${eventId}/guests/${g.id}/noshow`, { method: "POST" });
            refresh();
            toast.success(`${g.firstName} ${g.lastName} marked no-show — seat freed.`);
          }}
        />
      )}
      {showWalkIn && (
        <ManualWalkInModal
          eventId={eventId}
          publicSlug={publicSlug}
          onClose={() => setShowWalkIn(false)}
          onDone={() => { setShowWalkIn(false); refresh(); }}
        />
      )}
      {reassigning && (
        <ReassignModal
          guest={reassigning}
          tables={layout?.tables ?? []}
          guests={guests}
          onClose={() => setReassigning(null)}
          onSave={async (tableId) => {
            await fetch(`/api/events/${eventId}/guests/assign`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ guestIds: [reassigning.id], tableId }),
            });
            setReassigning(null);
            refresh();
            toast.success("Moved.");
          }}
        />
      )}
      {walkInApprove && (
        <WalkInApprovalModal
          walkIn={walkInApprove}
          eventId={eventId}
          tables={layout?.tables ?? []}
          guests={guests}
          onClose={() => setWalkInApprove(null)}
          onDone={() => { setWalkInApprove(null); refresh(); }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: "DRAFT" | "LIVE" | "ENDED" }) {
  if (status === "LIVE") return <span className="badge badge-green">● Live</span>;
  if (status === "ENDED") return <span className="badge badge-gray">Ended</span>;
  return <span className="badge badge-yellow">Draft</span>;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: "green" | "red" | "blue" | "gray" }) {
  const accentClass = accent === "green" ? "text-[#4af0c9]" : accent === "red" ? "text-[#ff5a72]" : accent === "blue" ? "text-[#4aa3ff]" : "text-[var(--color-fg-muted)]";
  return (
    <div className="text-center">
      <div className={`text-2xl font-bold tabular-nums ${accentClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] mt-0.5">{label}</div>
    </div>
  );
}

function TablePanel({
  table, guests, onClose, onReassign, onMarkNoShow, onCheckIn, onUncheckIn,
}: {
  table: TableT; guests: GuestT[]; onClose: () => void;
  onReassign: (g: GuestT) => void; onMarkNoShow: (g: GuestT) => void;
  onCheckIn: (g: GuestT) => void; onUncheckIn: (g: GuestT) => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 max-h-[70vh] overflow-auto card rounded-t-2xl rounded-b-none shadow-2xl border-t" onClick={(e) => e.stopPropagation()}>
      <div className="sticky top-0 bg-[var(--color-bg-elev)] px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">{table.label}</h3>
          <p className="text-xs text-[var(--color-fg-muted)]">{guests.length}/{table.capacity} {guests.length > table.capacity ? "⚠️ over capacity" : ""}</p>
        </div>
        <button onClick={onClose} className="btn btn-ghost h-9 w-9 p-0">✕</button>
      </div>
      {table.directionsText && (
        <div className="px-4 py-2 text-sm text-[var(--color-fg-muted)] italic border-b border-[var(--color-border-soft)]">{table.directionsText}</div>
      )}
      <ul className="p-2 space-y-1">
        {guests.length === 0 && <li className="text-sm text-[var(--color-fg-faint)] text-center py-6">No one assigned to this table.</li>}
        {guests.map(g => (
          <li key={g.id} className="px-3 py-2 rounded-lg hover:bg-[var(--color-bg-elev-2)] flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="font-medium flex items-center gap-2">
                {g.firstName} {g.lastName}
                {g.isWalkIn && <span className="badge badge-blue">walk-in</span>}
                {g.checkedInAt && <span className="badge badge-green">checked in</span>}
                {g.noShowFlaggedAt && !g.checkedInAt && <span className="badge badge-red">no-show?</span>}
              </div>
              {g.groupTag && <div className="text-xs text-[var(--color-fg-muted)]">{g.groupTag}</div>}
              {g.notes && <div className="text-xs text-[var(--color-fg-muted)] truncate">{g.notes}</div>}
            </div>
            <div className="flex items-center gap-1">
              {!g.checkedInAt ? (
                <button onClick={() => onCheckIn(g)} className="btn h-8 px-2 text-xs">Check in</button>
              ) : (
                <button onClick={() => onUncheckIn(g)} className="btn btn-ghost h-8 px-2 text-xs">Undo</button>
              )}
              <button onClick={() => onReassign(g)} className="btn h-8 px-2 text-xs">Move</button>
              <button onClick={() => onMarkNoShow(g)} className="btn btn-danger h-8 px-2 text-xs">No-show</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchModal({ guests, tables, onClose, onPickGuest, title }: {
  guests: GuestT[]; tables: TableT[]; onClose: () => void; onPickGuest: (g: GuestT) => void; title?: string;
}) {
  const [q, setQ] = useState("");
  const filtered = guests.filter(g => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 50);
  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex items-start justify-center p-4 pt-20" onClick={onClose}>
      <div className="card w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
        {title && <div className="text-[13px] font-medium text-[var(--color-fg-muted)] mb-2 px-1">{title}</div>}
        <input autoFocus className="input h-12 text-lg" placeholder="Search guest…" value={q} onChange={e => setQ(e.target.value)} />
        <ul className="mt-2 max-h-[60vh] overflow-auto">
          {filtered.map(g => {
            const t = tables.find(t => t.id === g.assignedTableId);
            return (
              <li key={g.id}>
                <button onClick={() => onPickGuest(g)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-bg-elev-2)]">
                  <div className="font-medium">{g.firstName} {g.lastName}</div>
                  <div className="text-xs text-[var(--color-fg-muted)]">{t ? t.label : "Unassigned"} {g.checkedInAt ? "· checked in" : ""}</div>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="text-center text-sm text-[var(--color-fg-faint)] py-6">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

function ReassignModal({ guest, tables, guests, onClose, onSave }: {
  guest: GuestT; tables: TableT[]; guests: GuestT[];
  onClose: () => void; onSave: (tableId: string | null) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-1">Move {guest.firstName} {guest.lastName}</h3>
        <p className="text-sm text-[var(--color-fg-muted)] mb-4">Pick a new table or unassign.</p>
        <div className="max-h-[60vh] overflow-auto space-y-1">
          <button onClick={() => onSave(null)} className="btn w-full justify-between h-11 text-left px-4">
            <span>Unassign</span>
            <span className="text-xs text-[var(--color-fg-muted)]">remove from any table</span>
          </button>
          {tables.map(t => {
            const seated = guests.filter(g => g.assignedTableId === t.id).length;
            const isCurrent = guest.assignedTableId === t.id;
            return (
              <button
                key={t.id}
                onClick={() => onSave(t.id)}
                className={`btn w-full justify-between h-11 text-left px-4 ${isCurrent ? "border-[var(--color-brand)]" : ""}`}
              >
                <span>{t.label}</span>
                <span className="text-xs text-[var(--color-fg-muted)]">{seated}/{t.capacity}{isCurrent ? " · current" : ""}</span>
              </button>
            );
          })}
        </div>
        <button onClick={onClose} className="btn btn-ghost w-full h-11 mt-3">Cancel</button>
      </div>
    </div>
  );
}

function ManualWalkInModal({ eventId, publicSlug, onClose, onDone }: { eventId: string; publicSlug: string; onClose: () => void; onDone: () => void }) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/walkin/add`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: first.trim(), lastName: last.trim() }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Failed"); return; }
    toast.success("Walk-in added and seated.");
    onDone();
  }
  return (
    <div className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="card w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Add walk-in</h3>
        <input autoFocus className="input" placeholder="First name" value={first} onChange={e => setFirst(e.target.value)} />
        <input className="input" placeholder="Last name" value={last} onChange={e => setLast(e.target.value)} />
        <button type="submit" disabled={busy || (!first.trim() && !last.trim())} className="btn btn-primary w-full h-11">{busy ? "Adding…" : "Add & seat"}</button>
        <button type="button" onClick={onClose} className="btn btn-ghost w-full h-11">Cancel</button>
      </form>
    </div>
  );
}

function WalkInApprovalModal({ walkIn, eventId, tables, guests, onClose, onDone }: {
  walkIn: WalkInT; eventId: string; tables: TableT[]; guests: GuestT[];
  onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [recommendation, setRecommendation] = useState<{ tableId: string | null; reason: string; source: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/ai/smart-walkin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, walkInId: walkIn.id }),
      });
      if (!res.ok || cancelled) return;
      const data = await res.json();
      if (!cancelled) setRecommendation(data);
    })();
    return () => { cancelled = true; };
  }, [eventId, walkIn.id]);

  async function approve(tableId: string | null) {
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/walkin/${walkIn.id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tableId }),
    });
    setBusy(false);
    if (!res.ok) { toast.error("Approve failed"); return; }
    toast.success(`Seated ${walkIn.firstName} ${walkIn.lastName}`);
    onDone();
  }
  async function decline() {
    setBusy(true);
    await fetch(`/api/events/${eventId}/walkin/${walkIn.id}/decline`, { method: "POST" });
    setBusy(false);
    onDone();
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Walk-in</h3>
        <p className="text-sm text-[var(--color-fg-muted)] mb-1">{walkIn.firstName} {walkIn.lastName}</p>
        <p className="text-xs text-[var(--color-fg-faint)] mb-4">Arrived {fmtDateTime(walkIn.createdAt)}</p>
        {recommendation?.tableId && (
          <div className="mb-3 p-3 rounded-lg bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/30">
            <div className="text-xs text-[var(--color-fg-muted)] mb-1">
              ✨ Suggested ({recommendation.source})
            </div>
            <button
              onClick={() => approve(recommendation.tableId!)}
              disabled={busy}
              className="btn btn-primary w-full h-11 justify-between"
            >
              <span>{tables.find(t => t.id === recommendation.tableId)?.label ?? "Suggested table"}</span>
              <span className="text-xs opacity-90">{recommendation.reason}</span>
            </button>
          </div>
        )}
        <div className="space-y-1 max-h-[50vh] overflow-auto">
          {tables.map(t => {
            const seated = guests.filter(g => g.assignedTableId === t.id).length;
            const open = t.capacity - seated;
            return (
              <button
                key={t.id}
                onClick={() => approve(t.id)}
                disabled={busy || open <= 0}
                className="btn w-full justify-between h-11 text-left px-4"
              >
                <span>{t.label}</span>
                <span className="text-xs text-[var(--color-fg-muted)]">{open > 0 ? `${open} open` : "full"}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={decline} disabled={busy} className="btn btn-danger h-11">Decline</button>
          <button onClick={onClose} disabled={busy} className="btn h-11">Close</button>
        </div>
      </div>
    </div>
  );
}
