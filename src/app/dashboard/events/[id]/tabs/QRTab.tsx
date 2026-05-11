"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { LayoutForTabs } from "./LayoutTab";

export type QRForTabs = {
  id: string;
  label: string;
  scanOriginXPct: number | null;
  scanOriginYPct: number | null;
  tableId?: string | null;
  qrImageUrl: string | null;
};

type Landmark = { id: string; label: string; xPct: number; yPct: number };

// Every QR is linked to a location — landmark or table. No modes; one picker.
type Anchor =
  | { kind: "landmark"; id: string; label: string; xPct: number; yPct: number }
  | { kind: "table";    id: string; label: string; xPct: number; yPct: number; capacity: number };

export default function QRTab(props: {
  eventId: string;
  publicSlug: string;
  layout: LayoutForTabs | null;
  qrCodes: QRForTabs[];
  onChange: (next: QRForTabs[]) => void;
}) {
  const { eventId, publicSlug, layout, qrCodes, onChange } = props;
  const [creating, setCreating] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [wayfindingBusy, setWayfindingBusy] = useState(false);

  async function regenerateAll() {
    setRegenBusy(true);
    const res = await fetch(`/api/events/${eventId}/qr/bulk-auto`, { method: "POST" });
    setRegenBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not regenerate"); return; }
    const r = await fetch(`/api/events/${eventId}/state`);
    if (r.ok) {
      const s = await r.json();
      onChange(s.qrCodes);
    }
    if (data.created === 0) toast.info("All QRs already exist for every landmark and table.");
    else toast.success(`Added ${data.created} QR${data.created !== 1 ? "s" : ""} (${data.landmarks} landmark, ${data.tables} table).`);
  }

  const appUrl = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "";

  async function createForAnchor(anchor: Anchor) {
    setCreating(true);
    const body = anchor.kind === "table"
      ? { tableId: anchor.id }
      : { label: anchor.label, scanOriginXPct: anchor.xPct, scanOriginYPct: anchor.yPct };
    const res = await fetch(`/api/events/${eventId}/qr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setCreating(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not create QR"); return; }
    onChange([...qrCodes, data.qr]);
    setCreatorOpen(false);
    toast.success(`QR created for ${anchor.label}.`);
  }

  async function generateWayfinding() {
    if (qrCodes.length === 0) { toast.error("Add at least one QR first."); return; }
    if (!layout || layout.tables.length === 0) { toast.error("Need tables before generating directions."); return; }
    setWayfindingBusy(true);
    toast.info("AI is writing directions from every QR origin…");
    const res = await fetch(`/api/ai/wayfinding`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
    setWayfindingBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not generate directions"); return; }
    toast.success(`Directions written: ${data.persistedCount} sentences across ${data.results.length} origins.`);
  }

  async function deleteQr(id: string) {
    const qr = qrCodes.find(q => q.id === id);
    const msg = qr && !qr.tableId
      ? `Remove the "${qr.label}" QR? Sync from floor plan won't recreate it.`
      : "Remove this QR?";
    if (!confirm(msg)) return;
    const res = await fetch(`/api/events/${eventId}/qr/${id}`, { method: "DELETE" });
    if (res.ok) {
      onChange(qrCodes.filter(q => q.id !== id));
      toast.success(qr && !qr.tableId ? `Removed. "${qr.label}" stays out of future syncs.` : "Removed.");
    } else toast.error("Could not remove");
  }

  if (!layout) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[var(--color-fg-muted)] text-[14px]">Upload your floor plan first — every QR is anchored to a position on the plan.</p>
      </div>
    );
  }

  const landmarks: Landmark[] = layout.landmarks ?? [];
  const boundTableIds = new Set(qrCodes.filter(q => q.tableId).map(q => q.tableId));
  const anchors: Anchor[] = [
    ...landmarks.map((l): Anchor => ({ kind: "landmark", id: l.id, label: l.label, xPct: l.xPct, yPct: l.yPct })),
    ...layout.tables
      .filter((t): t is typeof t & { id: string } => typeof t.id === "string")
      .map((t): Anchor => ({ kind: "table", id: t.id, label: t.label, xPct: t.xPct, yPct: t.yPct, capacity: t.capacity })),
  ];

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="font-medium text-[16px] mb-1 tracking-tight">QR codes</h3>
            <p className="text-[13px] text-[var(--color-fg-muted)] max-w-md">
              One QR per landmark + one per table, auto-generated from your floor plan. Delete the ones you don&apos;t need. Print and post.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={regenerateAll} disabled={regenBusy || creating} className="btn h-10 text-[13px]">
              {regenBusy ? "Syncing…" : "Sync from floor plan"}
            </button>
            <button onClick={() => setCreatorOpen(true)} disabled={creating} className="btn h-10 text-[13px]">
              + Custom location
            </button>
          </div>
        </div>

        {qrCodes.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[13px] text-[var(--color-fg-muted)] mb-3">No QR codes yet. Click <strong>Sync from floor plan</strong> to generate one per landmark and table.</p>
            <button onClick={regenerateAll} disabled={regenBusy} className="btn btn-primary h-10 text-[13px]">
              {regenBusy ? "Generating…" : "Sync from floor plan"}
            </button>
          </div>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {qrCodes.map(q => (
                <div key={q.id} className="card p-4">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div>
                      <h4 className="font-medium tracking-tight">{q.label}</h4>
                      <p className="text-[11px] text-[var(--color-fg-muted)] mt-0.5 uppercase tracking-[0.06em]">
                        {q.tableId
                          ? `Table tent · ${layout.tables.find(t => t.id === q.tableId)?.label ?? ""}`
                          : "Landmark"}
                      </p>
                    </div>
                    <button onClick={() => deleteQr(q.id)} title="Remove this QR" className="btn btn-danger h-8 px-2 text-[12px]">Remove</button>
                  </div>
                  <div className="bg-white rounded-lg p-3 flex items-center justify-center aspect-square border border-[var(--color-border-soft)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/qr/png?eventSlug=${publicSlug}&qr=${q.id}`} alt={`QR ${q.label}`} className="w-full h-full object-contain" />
                  </div>
                  <div className="mt-3 text-[10px] font-mono text-[var(--color-fg-faint)] truncate">
                    {appUrl}/e/{publicSlug}?qr={q.id}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <a href={`/api/qr/print?eventSlug=${publicSlug}&qr=${q.id}`} target="_blank" rel="noreferrer" className="btn h-9 px-3 text-[12px] flex-1 justify-center">Print</a>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between p-4 rounded-xl bg-[var(--color-surface-2)] border border-[var(--color-border-soft)]">
              <div>
                <div className="text-[14px] font-medium">Origin-aware directions</div>
                <div className="text-[12px] text-[var(--color-fg-muted)]">
                  AI writes one direction from every QR origin to every table. Run after you finalize QRs.
                </div>
              </div>
              <button onClick={generateWayfinding} disabled={wayfindingBusy} className="btn btn-accent h-10 text-[13px]">
                {wayfindingBusy ? "Writing…" : "✨ Write directions"}
              </button>
            </div>
          </>
        )}
      </div>

      {creatorOpen && (
        <QrCreatorModal
          layout={layout}
          anchors={anchors}
          boundTableIds={boundTableIds}
          existingLabels={new Set(qrCodes.map(q => q.label.toLowerCase()))}
          onCancel={() => setCreatorOpen(false)}
          onPick={createForAnchor}
          busy={creating}
        />
      )}
    </div>
  );
}

function QrCreatorModal({
  layout,
  anchors,
  boundTableIds,
  existingLabels,
  onCancel,
  onPick,
  busy,
}: {
  layout: LayoutForTabs;
  anchors: Anchor[];
  boundTableIds: Set<string | null | undefined>;
  existingLabels: Set<string>;
  onCancel: () => void;
  onPick: (a: Anchor) => void;
  busy: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(anchors[0]?.id ?? "");
  const selected = anchors.find(a => a.id === selectedId) ?? null;
  const landmarks = anchors.filter(a => a.kind === "landmark");
  const tables = anchors.filter(a => a.kind === "table");

  return (
    <div className="fixed inset-0 bg-[var(--color-overlay)] z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="card max-w-3xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-[var(--color-border)]">
          <h3 className="text-[18px] font-medium tracking-tight mb-1">Where does this QR go?</h3>
          <p className="text-[13px] text-[var(--color-fg-muted)]">Pick the spot. Position is auto-set from your floor plan.</p>
        </div>

        <div className="grid sm:grid-cols-[280px_1fr] gap-0">
          <div className="border-r border-[var(--color-border)] max-h-[60vh] overflow-auto">
            {landmarks.length > 0 && (
              <>
                <SectionLabel>Landmarks</SectionLabel>
                {landmarks.map(a => (
                  <AnchorRow
                    key={a.id}
                    anchor={a}
                    selected={selectedId === a.id}
                    onSelect={() => setSelectedId(a.id)}
                    dimmed={existingLabels.has(a.label.toLowerCase())}
                    hint={existingLabels.has(a.label.toLowerCase()) ? "Already has a QR" : undefined}
                  />
                ))}
              </>
            )}
            {tables.length > 0 && (
              <>
                <SectionLabel>Tables</SectionLabel>
                {tables.map(a => {
                  const taken = a.kind === "table" && boundTableIds.has(a.id);
                  return (
                    <AnchorRow
                      key={a.id}
                      anchor={a}
                      selected={selectedId === a.id}
                      onSelect={() => setSelectedId(a.id)}
                      dimmed={taken}
                      hint={taken ? "Already has a QR" : (a.kind === "table" ? `${a.capacity} seats` : undefined)}
                    />
                  );
                })}
              </>
            )}
            {anchors.length === 0 && (
              <div className="px-4 py-6 text-[13px] text-[var(--color-fg-muted)]">
                No landmarks or tables on this floor plan yet. Upload + AI-parse the plan first.
              </div>
            )}
          </div>

          <div className="p-5">
            <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] mb-2">Preview</div>
            <div className="rounded-lg overflow-hidden border border-[var(--color-border)] relative" style={{ paddingTop: `${(layout.sourceImageHeight / layout.sourceImageWidth) * 100}%`, background: "#FFF" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={layout.sourceImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
              {layout.tables.map(t => (
                <div
                  key={t.id}
                  className={`pin ${selected?.kind === "table" && selected.id === t.id ? "pin-default pin-selected" : "pin-gray"}`}
                  style={{ left: `${t.xPct}%`, top: `${t.yPct}%`, pointerEvents: "none", width: 22, height: 22, fontSize: 10 }}
                >
                  {t.label.match(/\d+/)?.[0] ?? "•"}
                </div>
              ))}
              {selected && selected.kind === "landmark" && (
                <div className="you-are-here" style={{ left: `${selected.xPct}%`, top: `${selected.yPct}%` }} />
              )}
            </div>
            <div className="mt-3 text-[13px] text-[var(--color-fg-muted)]">
              {selected ? (
                <>Creating a QR for <strong className="text-[var(--color-fg)]">{selected.label}</strong>. Print it and post at that spot.</>
              ) : (
                "Pick a location on the left."
              )}
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-[var(--color-border)] flex items-center gap-2">
          <button
            onClick={() => selected && onPick(selected)}
            disabled={!selected || busy}
            className="btn btn-primary flex-1 h-11 text-[14px]"
          >
            {busy ? "Creating…" : "Create QR"}
          </button>
          <button onClick={onCancel} className="btn h-11 text-[14px]">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-4 pb-2 text-[11px] uppercase tracking-[0.08em] text-[var(--color-fg-muted)] font-medium">
      {children}
    </div>
  );
}

function AnchorRow({
  anchor, selected, onSelect, dimmed, hint,
}: {
  anchor: Anchor;
  selected: boolean;
  onSelect: () => void;
  dimmed?: boolean;
  hint?: string;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={dimmed}
      className={`w-full text-left px-4 py-3 flex items-center justify-between gap-2 border-b border-[var(--color-border-soft)] last:border-b-0 transition-colors ${
        selected
          ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
          : "hover:bg-[var(--color-surface-2)] text-[var(--color-fg)]"
      } ${dimmed ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <div>
        <div className="text-[14px] font-medium leading-tight">{anchor.label}</div>
        {hint && <div className="text-[11px] text-[var(--color-fg-muted)] mt-0.5">{hint}</div>}
      </div>
      {selected && <span className="text-[var(--color-fg-muted)] text-[16px]">›</span>}
    </button>
  );
}
