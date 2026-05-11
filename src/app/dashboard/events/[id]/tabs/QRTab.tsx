"use client";

import { useState, useRef } from "react";
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

type CreateDraft =
  | { kind: "landmark"; label: string; xPct: number; yPct: number }
  | { kind: "table"; tableId: string };

export default function QRTab(props: {
  eventId: string;
  publicSlug: string;
  layout: LayoutForTabs | null;
  qrCodes: QRForTabs[];
  onChange: (next: QRForTabs[]) => void;
}) {
  const { eventId, publicSlug, layout, qrCodes, onChange } = props;
  const [creating, setCreating] = useState(false);
  const [creator, setCreator] = useState<"closed" | "open">("closed");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [wayfindingBusy, setWayfindingBusy] = useState(false);

  const appUrl = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "";

  async function submitCreate(draft: CreateDraft) {
    setCreating(true);
    const body = draft.kind === "landmark"
      ? { label: draft.label, scanOriginXPct: draft.xPct, scanOriginYPct: draft.yPct }
      : { tableId: draft.tableId };
    const res = await fetch(`/api/events/${eventId}/qr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setCreating(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not create QR"); return; }
    onChange([...qrCodes, data.qr]);
    setCreator("closed");
    toast.success("QR created.");
  }

  async function generateOneQrPerTable() {
    setBulkBusy(true);
    const res = await fetch(`/api/events/${eventId}/qr/bulk-tables`, { method: "POST" });
    setBulkBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not generate"); return; }
    // Refetch QRs
    const r = await fetch(`/api/events/${eventId}/state`);
    if (r.ok) {
      const s = await r.json();
      onChange(s.qrCodes);
    }
    toast.success(`${data.created} QR${data.created !== 1 ? "s" : ""} created (one per table).`);
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
    toast.success(`Directions written: ${data.persistedCount} entries across ${data.results.length} origins.`);
  }

  async function deleteQr(id: string) {
    if (!confirm("Delete this QR?")) return;
    const res = await fetch(`/api/events/${eventId}/qr/${id}`, { method: "DELETE" });
    if (res.ok) {
      onChange(qrCodes.filter(q => q.id !== id));
      toast.success("Deleted.");
    } else toast.error("Could not delete");
  }

  if (!layout) {
    return (
      <div className="card p-8 text-center">
        <p className="text-[var(--color-fg-muted)] text-[14px]">Upload your floor plan first — every QR is anchored to a position on the plan.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h3 className="font-medium text-[16px] mb-1 tracking-tight">QR codes</h3>
            <p className="text-[13px] text-[var(--color-fg-muted)] max-w-md">
              Every QR is anchored to a specific spot on your plan — either a landmark you tap, or a table you pick. The anchor powers the &quot;you are here&quot; pulse and per-origin directions.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={generateOneQrPerTable} disabled={bulkBusy || creating} className="btn h-10 text-[13px]">
              {bulkBusy ? "Generating…" : "+ One per table"}
            </button>
            <button onClick={() => setCreator("open")} disabled={creating} className="btn btn-primary h-10 text-[13px]">
              + New QR
            </button>
          </div>
        </div>

        {qrCodes.length === 0 ? (
          <p className="text-[13px] text-[var(--color-fg-muted)] py-2">No QR codes yet. Add at least one to publish.</p>
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
                          ? `Bound to ${layout.tables.find(t => t.id === q.tableId)?.label ?? "table"}`
                          : "Landmark anchor"}
                      </p>
                    </div>
                    <button onClick={() => deleteQr(q.id)} className="btn btn-ghost h-8 w-8 p-0 text-[13px]">✕</button>
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
                  AI writes one direction from every QR origin to every table. Run this after you finalize QRs.
                </div>
              </div>
              <button onClick={generateWayfinding} disabled={wayfindingBusy} className="btn btn-accent h-10 text-[13px]">
                {wayfindingBusy ? "Writing…" : "✨ Write directions"}
              </button>
            </div>
          </>
        )}
      </div>

      {creator === "open" && (
        <QrCreatorModal
          layout={layout}
          existingQrCount={qrCodes.length}
          onCancel={() => setCreator("closed")}
          onSubmit={submitCreate}
          busy={creating}
        />
      )}
    </div>
  );
}

function QrCreatorModal({
  layout,
  existingQrCount,
  onCancel,
  onSubmit,
  busy,
}: {
  layout: LayoutForTabs;
  existingQrCount: number;
  onCancel: () => void;
  onSubmit: (d: CreateDraft) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<"landmark" | "table">("landmark");
  const [label, setLabel] = useState(existingQrCount === 0 ? "Main Entrance" : "");
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [tableId, setTableId] = useState<string>(layout.tables[0]?.id ?? "");
  const imgRef = useRef<HTMLDivElement>(null);

  function tap(e: React.MouseEvent<HTMLDivElement>) {
    if (!imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    setCoords({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  }

  const canSubmit = mode === "landmark"
    ? !!label.trim() && coords !== null
    : !!tableId;

  function submit() {
    if (mode === "landmark" && coords) {
      onSubmit({ kind: "landmark", label: label.trim(), xPct: coords.x, yPct: coords.y });
    } else if (mode === "table") {
      onSubmit({ kind: "table", tableId });
    }
  }

  return (
    <div className="fixed inset-0 bg-[var(--color-overlay)] z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="card max-w-3xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-[var(--color-border)]">
          <h3 className="text-[18px] font-medium tracking-tight mb-1">New QR code</h3>
          <p className="text-[13px] text-[var(--color-fg-muted)]">Pick where this QR will physically live. Every QR needs a location — that&apos;s how directions know where you&apos;re standing.</p>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 p-1 bg-[var(--color-surface-2)] rounded-lg">
            <button
              onClick={() => setMode("landmark")}
              className={`h-10 rounded-md text-[13px] font-medium transition-colors ${mode === "landmark" ? "bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm" : "text-[var(--color-fg-muted)]"}`}
            >
              📍 Landmark
            </button>
            <button
              onClick={() => setMode("table")}
              className={`h-10 rounded-md text-[13px] font-medium transition-colors ${mode === "table" ? "bg-[var(--color-surface)] text-[var(--color-fg)] shadow-sm" : "text-[var(--color-fg-muted)]"}`}
            >
              🪑 Table tent
            </button>
          </div>

          {mode === "landmark" && (
            <>
              <div>
                <label className="label">Label</label>
                <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="Main Entrance, Bar, Lobby, Coat Check" maxLength={40} />
              </div>
              <div>
                <label className="label">Tap on the floor plan to place this QR</label>
                <div
                  ref={imgRef}
                  onClick={tap}
                  className="relative cursor-crosshair rounded-lg overflow-hidden border border-[var(--color-border)]"
                  style={{ paddingTop: `${(layout.sourceImageHeight / layout.sourceImageWidth) * 100}%`, background: "#FFF" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={layout.sourceImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                  {layout.tables.map(t => (
                    <div key={t.id} className="pin pin-gray" style={{ left: `${t.xPct}%`, top: `${t.yPct}%`, pointerEvents: "none", width: 22, height: 22, fontSize: 10 }}>
                      {t.label.match(/\d+/)?.[0] ?? "•"}
                    </div>
                  ))}
                  {coords && (
                    <div className="you-are-here" style={{ left: `${coords.x}%`, top: `${coords.y}%` }} />
                  )}
                </div>
                <p className="mt-2 text-[12px] text-[var(--color-fg-muted)]">
                  {coords ? `Set to ${coords.x.toFixed(1)}% / ${coords.y.toFixed(1)}%` : "No location chosen yet — tap the image."}
                </p>
              </div>
            </>
          )}

          {mode === "table" && (
            <>
              <div>
                <label className="label">Pick a table</label>
                <select className="input" value={tableId} onChange={e => setTableId(e.target.value)}>
                  {layout.tables.map(t => (
                    <option key={t.id} value={t.id}>{t.label} ({t.capacity} seats)</option>
                  ))}
                </select>
                <p className="mt-2 text-[12px] text-[var(--color-fg-muted)]">Auto-anchors to this table&apos;s position. Use this for printed table tents.</p>
              </div>
              <div className="rounded-lg overflow-hidden border border-[var(--color-border)] relative" style={{ paddingTop: `${(layout.sourceImageHeight / layout.sourceImageWidth) * 100}%`, background: "#FFF" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={layout.sourceImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
                {layout.tables.map(t => (
                  <div
                    key={t.id}
                    className={`pin ${t.id === tableId ? "pin-default pin-selected" : "pin-gray"}`}
                    style={{ left: `${t.xPct}%`, top: `${t.yPct}%`, pointerEvents: "none" }}
                  >
                    {t.label.match(/\d+/)?.[0] ?? "•"}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-[var(--color-border)] flex items-center gap-2">
          <button onClick={submit} disabled={!canSubmit || busy} className="btn btn-primary flex-1 h-11 text-[14px]">
            {busy ? "Creating…" : "Create QR"}
          </button>
          <button onClick={onCancel} className="btn h-11 text-[14px]">Cancel</button>
        </div>
      </div>
    </div>
  );
}
