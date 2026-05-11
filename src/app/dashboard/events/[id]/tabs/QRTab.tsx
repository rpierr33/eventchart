"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import type { LayoutForTabs } from "./LayoutTab";

export type QRForTabs = {
  id: string;
  label: string;
  scanOriginXPct: number | null;
  scanOriginYPct: number | null;
  qrImageUrl: string | null;
};

export default function QRTab(props: {
  eventId: string;
  publicSlug: string;
  layout: LayoutForTabs | null;
  qrCodes: QRForTabs[];
  onChange: (next: QRForTabs[]) => void;
}) {
  const { eventId, publicSlug, layout, qrCodes, onChange } = props;
  const [creating, setCreating] = useState(false);
  const [anchoring, setAnchoring] = useState<QRForTabs | null>(null);
  const imgRef = useRef<HTMLDivElement>(null);

  const appUrl = typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL || "";

  async function createQr(label: string) {
    setCreating(true);
    const res = await fetch(`/api/events/${eventId}/qr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label }),
    });
    setCreating(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not create QR"); return; }
    onChange([...qrCodes, data.qr]);
    toast.success("QR created.");
  }

  async function deleteQr(id: string) {
    if (!confirm("Delete this QR?")) return;
    const res = await fetch(`/api/events/${eventId}/qr/${id}`, { method: "DELETE" });
    if (res.ok) {
      onChange(qrCodes.filter(q => q.id !== id));
      toast.success("Deleted.");
    } else toast.error("Could not delete");
  }

  async function setAnchor(qrId: string, xPct: number, yPct: number) {
    const res = await fetch(`/api/events/${eventId}/qr/${qrId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scanOriginXPct: xPct, scanOriginYPct: yPct }),
    });
    const data = await res.json();
    if (res.ok) {
      onChange(qrCodes.map(q => q.id === qrId ? { ...q, scanOriginXPct: xPct, scanOriginYPct: yPct } : q));
      toast.success("Anchor set.");
      setAnchoring(null);
    } else toast.error(data?.error ?? "Could not save anchor");
  }

  function handleAnchorClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!anchoring || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    setAnchor(anchoring.id, xPct, yPct);
  }

  return (
    <div className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold mb-1">QR codes</h3>
            <p className="text-sm text-[var(--color-fg-muted)]">Default is one at the entrance. Add more for landmarks (bar, lobby) so directions can say &quot;walk that way&quot;.</p>
          </div>
          <button
            onClick={() => {
              const label = prompt("Label for this QR (e.g., Main Entrance, Lobby, Bar):", qrCodes.length === 0 ? "Main Entrance" : "");
              if (label) createQr(label.trim());
            }}
            disabled={creating}
            className="btn btn-primary h-10"
          >
            + Add QR code
          </button>
        </div>
        {qrCodes.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-muted)] py-3">No QR codes yet. Add at least one to enable guest lookup.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {qrCodes.map(q => (
              <div key={q.id} className="card p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h4 className="font-semibold">{q.label}</h4>
                    <p className="text-xs text-[var(--color-fg-muted)] mt-0.5">
                      {q.scanOriginXPct !== null && q.scanOriginYPct !== null ? "Anchored to layout" : "No anchor yet"}
                    </p>
                  </div>
                  <button onClick={() => deleteQr(q.id)} className="btn btn-ghost h-8 w-8 p-0 text-sm">✕</button>
                </div>
                <div className="bg-white rounded-lg p-3 flex items-center justify-center aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/qr/png?eventSlug=${publicSlug}&qr=${q.id}`} alt={`QR ${q.label}`} className="w-full h-full object-contain" />
                </div>
                <div className="mt-3 text-xs text-[var(--color-fg-faint)] truncate">
                  {appUrl}/e/{publicSlug}?qr={q.id}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <a
                    href={`/api/qr/print?eventSlug=${publicSlug}&qr=${q.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn h-9 px-3 text-xs flex-1 justify-center"
                  >
                    🖨 Print
                  </a>
                  {layout && (
                    <button onClick={() => setAnchoring(q)} className="btn h-9 px-3 text-xs flex-1 justify-center">
                      📍 Set anchor
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {anchoring && layout && (
        <div className="fixed inset-0 bg-black/70 z-50 flex flex-col p-4">
          <div className="flex items-center justify-between mb-3 text-white">
            <div>
              <h3 className="font-semibold">Tap where &quot;{anchoring.label}&quot; is on the floor plan</h3>
              <p className="text-sm opacity-70">This becomes the &quot;you are here&quot; anchor for guests scanning this QR.</p>
            </div>
            <button onClick={() => setAnchoring(null)} className="btn">Cancel</button>
          </div>
          <div className="flex-1 overflow-auto card p-2">
            <div
              ref={imgRef}
              onClick={handleAnchorClick}
              className="relative cursor-crosshair"
              style={{ paddingTop: `${(layout.sourceImageHeight / layout.sourceImageWidth) * 100}%` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={layout.sourceImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
              {layout.tables.map(t => (
                <div key={t.id} className="pin pin-default" style={{ left: `${t.xPct}%`, top: `${t.yPct}%`, pointerEvents: "none" }}>
                  {t.label.match(/\d+/)?.[0] ?? "•"}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
