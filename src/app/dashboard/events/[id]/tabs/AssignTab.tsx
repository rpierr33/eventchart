"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import type { LayoutForTabs } from "./LayoutTab";
import type { GuestForTabs } from "./GuestsTab";

export default function AssignTab(props: {
  eventId: string;
  layout: LayoutForTabs | null;
  guests: GuestForTabs[];
  onChange: (next: GuestForTabs[]) => void;
}) {
  const { eventId, layout, guests, onChange } = props;
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<null | { byGuest: Map<string, string>; reasons: Map<string, string>; source: string }>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [constraint, setConstraint] = useState("");

  async function suggest() {
    setSuggesting(true);
    try {
      const res = await fetch(`/api/ai/suggest-assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId, naturalConstraints: constraint.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Suggest failed");
      const byGuest = new Map<string, string>();
      const reasons = new Map<string, string>();
      for (const a of data.assignments) {
        byGuest.set(a.guestId, a.tableId);
        if (a.reason) reasons.set(a.guestId, a.reason);
      }
      setDraft({ byGuest, reasons, source: data.source ?? "heuristic" });
      toast.success(`Drafted ${byGuest.size} assignments. Review, edit, then accept.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSuggesting(false);
    }
  }

  async function applyDraft() {
    if (!draft) return;
    const ops: Promise<Response>[] = [];
    const buckets = new Map<string, string[]>();
    for (const [guestId, tableId] of draft.byGuest) {
      if (!buckets.has(tableId)) buckets.set(tableId, []);
      buckets.get(tableId)!.push(guestId);
    }
    for (const [tableId, guestIds] of buckets) {
      ops.push(fetch(`/api/events/${eventId}/guests/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guestIds, tableId }),
      }));
    }
    const results = await Promise.all(ops);
    if (results.every(r => r.ok)) {
      onChange(guests.map(g => draft.byGuest.has(g.id) ? { ...g, assignedTableId: draft.byGuest.get(g.id)! } : g));
      setDraft(null);
      toast.success("Assignments applied.");
    } else {
      toast.error("Some assignments failed");
    }
  }

  const guestsByTable = useMemo(() => {
    const map = new Map<string | null, GuestForTabs[]>();
    for (const g of guests) {
      const key = g.assignedTableId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(g);
    }
    return map;
  }, [guests]);

  const unassigned = guestsByTable.get(null) ?? [];

  const filteredUnassigned = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return unassigned;
    return unassigned.filter(g => `${g.firstName} ${g.lastName} ${g.groupTag ?? ""}`.toLowerCase().includes(needle));
  }, [unassigned, q]);

  function toggle(id: string) {
    setSelectedGuestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function assignSelected(tableId: string | null) {
    if (selectedGuestIds.size === 0) return;
    const ids = Array.from(selectedGuestIds);
    const res = await fetch(`/api/events/${eventId}/guests/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestIds: ids, tableId }),
    });
    if (!res.ok) { toast.error("Assign failed"); return; }
    onChange(guests.map(g => ids.includes(g.id) ? { ...g, assignedTableId: tableId } : g));
    setSelectedGuestIds(new Set());
    toast.success(tableId ? "Assigned." : "Unassigned.");
  }

  if (!layout) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[var(--color-fg-muted)]">Upload a floor plan and drop pins first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-center gap-2">
        <input
          className="input flex-1 min-w-[200px] h-10"
          placeholder='Constraints in plain English ("kids at the back", "Eric Shipp at head table")'
          value={constraint}
          onChange={e => setConstraint(e.target.value)}
        />
        <button onClick={suggest} disabled={suggesting || unassigned.length === 0} className="btn btn-primary h-10 text-sm">
          {suggesting ? "Thinking…" : "✨ Suggest assignments"}
        </button>
        {draft && (
          <>
            <span className="badge badge-blue">{draft.byGuest.size} drafted ({draft.source})</span>
            <button onClick={applyDraft} className="btn btn-primary h-10 text-sm">Accept all</button>
            <button onClick={() => setDraft(null)} className="btn btn-ghost h-10 text-sm">Discard</button>
          </>
        )}
      </div>

    <div className="grid lg:grid-cols-[320px_1fr] gap-5">
      <div className="card p-4 space-y-3 lg:max-h-[calc(100vh-180px)] overflow-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Unassigned</h3>
          <span className="text-xs text-[var(--color-fg-muted)]">{unassigned.length}</span>
        </div>
        <input className="input h-9" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        {selectedGuestIds.size > 0 && (
          <div className="rounded-lg bg-[var(--color-bg-elev-2)] p-2 text-xs space-y-2">
            <div className="text-[var(--color-fg-muted)]">{selectedGuestIds.size} selected · tap a table →</div>
            <button onClick={() => setSelectedGuestIds(new Set())} className="btn btn-ghost h-7 px-2 text-xs">Clear</button>
          </div>
        )}
        <ul className="space-y-1">
          {filteredUnassigned.map(g => (
            <li key={g.id}>
              <button
                onClick={() => toggle(g.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm border ${
                  selectedGuestIds.has(g.id)
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)]/10"
                    : "border-transparent hover:bg-[var(--color-bg-elev-2)]"
                }`}
              >
                <div className="font-medium">{g.firstName} {g.lastName}</div>
                {g.groupTag && <div className="text-xs text-[var(--color-fg-muted)]">{g.groupTag}</div>}
              </button>
            </li>
          ))}
          {filteredUnassigned.length === 0 && (
            <li className="text-xs text-[var(--color-fg-faint)] text-center py-4">
              {unassigned.length === 0 ? "All guests assigned ✓" : "No matches"}
            </li>
          )}
        </ul>
      </div>

      <div className="space-y-4">
        {layout.tables.length === 0 && (
          <div className="card p-6 text-center">
            <p className="text-[var(--color-fg-muted)]">No tables yet. Drop pins in the Layout tab first.</p>
          </div>
        )}
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {layout.tables.map(table => {
            const seated = guestsByTable.get(table.id ?? "") ?? [];
            const draftedHere = draft ? guests.filter(g => draft.byGuest.get(g.id) === table.id && !seated.some(s => s.id === g.id)) : [];
            const free = Math.max(0, table.capacity - seated.length);
            const over = seated.length > table.capacity;
            return (
              <div key={table.id} className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h4 className="font-semibold">{table.label}</h4>
                    <p className="text-xs text-[var(--color-fg-muted)]">
                      {seated.length}/{table.capacity} {over ? "⚠️ over" : free > 0 ? `· ${free} open` : "· full"}
                    </p>
                  </div>
                  {selectedGuestIds.size > 0 && (
                    <button
                      onClick={() => assignSelected(table.id!)}
                      className="btn btn-primary h-8 px-3 text-xs"
                    >
                      Seat {selectedGuestIds.size}
                    </button>
                  )}
                </div>
                <ul className="space-y-1">
                  {seated.map(g => (
                    <li key={g.id} className="text-sm flex items-center justify-between rounded px-2 py-1 hover:bg-[var(--color-bg-elev-2)]">
                      <span>{g.firstName} {g.lastName}</span>
                      <button
                        onClick={() => {
                          setSelectedGuestIds(new Set([g.id]));
                          assignSelected(null);
                        }}
                        className="btn btn-ghost h-7 px-2 text-xs"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {draftedHere.map(g => (
                    <li key={g.id} className="text-sm flex items-center justify-between rounded px-2 py-1 bg-[var(--color-brand)]/10 border border-[var(--color-brand)]/30">
                      <span className="flex items-center gap-1">
                        <span className="text-xs">✨</span>
                        {g.firstName} {g.lastName}
                      </span>
                      <button
                        onClick={() => {
                          if (!draft) return;
                          const nb = new Map(draft.byGuest);
                          nb.delete(g.id);
                          setDraft({ ...draft, byGuest: nb });
                        }}
                        className="btn btn-ghost h-7 px-2 text-xs"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                  {seated.length === 0 && draftedHere.length === 0 && (
                    <li className="text-xs text-[var(--color-fg-faint)] py-2">No one seated yet</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}
