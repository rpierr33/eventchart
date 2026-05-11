"use client";

import { useState } from "react";
import { toast } from "sonner";
import { arrayBufferToBase64 } from "@/lib/utils";

export type TableForTabs = {
  id?: string;
  label: string;
  capacity: number;
  xPct: number;
  yPct: number;
  directionsText: string | null;
  notes: string | null;
};

export type LayoutForTabs = {
  id: string;
  name: string;
  sourceImageUrl: string;
  sourceImageWidth: number;
  sourceImageHeight: number;
  tables: TableForTabs[];
  landmarks?: Array<{ id: string; label: string; xPct: number; yPct: number }>;
};

export type TemplateOption = {
  id: string;
  name: string;
  tableCount: number;
  sourceImageUrl: string;
  sourceImageWidth: number;
  sourceImageHeight: number;
};

export default function LayoutTab(props: {
  eventId: string;
  layout: LayoutForTabs | null;
  templates: TemplateOption[];
  onChange: (next: LayoutForTabs | null) => void;
}) {
  const { eventId, layout, templates, onChange } = props;
  const [uploading, setUploading] = useState(false);
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  async function handleUploadImage(file: File) {
    setUploading(true);
    try {
      // 1. Read image dims and upload to storage
      const dims = await readImageDims(file);
      const fd = new FormData();
      fd.append("file", file);
      const upRes = await fetch("/api/upload", { method: "POST", body: fd });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(upData?.error ?? "Upload failed");

      // 2. Create Layout row pointing to the image
      const createRes = await fetch(`/api/events/${eventId}/layout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, ""),
          sourceImageUrl: upData.url,
          sourceImageWidth: dims.w,
          sourceImageHeight: dims.h,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData?.error ?? "Layout create failed");

      // 3. Run AI vision on the image to extract every table
      toast.info("AI is reading your floor plan…");
      const mediaType = file.type === "image/jpg" ? "image/jpeg" : file.type;
      const buf = await file.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      const aiRes = await fetch("/api/ai/parse-layout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: b64, mediaType }),
      });
      const aiData = await aiRes.json();
      if (!aiRes.ok) {
        toast.error(aiData?.error ?? "AI parse failed. Set ANTHROPIC_API_KEY.");
        onChange(createData.layout);
        return;
      }
      const aiTables = Array.isArray(aiData.tables) ? aiData.tables : [];
      if (aiTables.length === 0) {
        toast.warning("AI didn't find any tables. Try a clearer image.");
        onChange(createData.layout);
        return;
      }

      // 4. Persist detected tables
      const persistRes = await fetch(`/api/events/${eventId}/tables`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tables: aiTables.map((t: { label?: string; xPct?: number; yPct?: number; capacityEstimate?: number }) => ({
            label: t.label || "Table",
            capacity: t.capacityEstimate || 8,
            xPct: t.xPct ?? 50,
            yPct: t.yPct ?? 50,
            directionsText: null,
            notes: null,
          })),
          deleteIds: [],
        }),
      });
      if (!persistRes.ok) throw new Error("Could not save detected tables");
      const pd = await persistRes.json();

      // 5. Persist detected landmarks (entrance, bar, stage, ...)
      const aiLandmarks = Array.isArray(aiData.landmarks) ? aiData.landmarks : [];
      if (aiLandmarks.length > 0) {
        await fetch(`/api/events/${eventId}/landmarks`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            landmarks: aiLandmarks.map((l: { label?: string; xPct?: number; yPct?: number }) => ({
              label: l.label || "Landmark",
              xPct: l.xPct ?? 50,
              yPct: l.yPct ?? 50,
            })),
          }),
        }).catch(() => {});
      }

      // 6. Auto-generate every QR the floor plan implies: one per detected landmark + one per table.
      //    The system already knows every location — no need to ask the planner.
      const qrGenRes = await fetch(`/api/events/${eventId}/qr/bulk-auto`, { method: "POST" });
      let qrCreated = 0;
      if (qrGenRes.ok) {
        const qrData = await qrGenRes.json();
        qrCreated = qrData.created ?? 0;
      }

      toast.success(
        `Detected ${pd.tables.length} tables${aiLandmarks.length ? ` + ${aiLandmarks.length} landmarks` : ""}` +
        (qrCreated ? `. Auto-generated ${qrCreated} QR codes — see the QR tab.` : ".")
      );
      onChange({ ...createData.layout, tables: pd.tables });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleUseTemplate(templateId: string) {
    setUploading(true);
    try {
      const t = templates.find(t => t.id === templateId);
      if (!t) return;
      const res = await fetch(`/api/events/${eventId}/layout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: t.name,
          sourceImageUrl: t.sourceImageUrl,
          sourceImageWidth: t.sourceImageWidth,
          sourceImageHeight: t.sourceImageHeight,
          templateId: t.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Template load failed");
      toast.success("Template loaded.");
      onChange(data.layout);
      setShowTemplates(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setUploading(false);
    }
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type === "application/pdf") {
      setPendingPdf(file);
      return;
    }
    handleUploadImage(file);
  }

  if (!layout) {
    return (
      <div className="card p-8 text-center">
        <div className="text-5xl mb-3">📐</div>
        <h3 className="text-xl font-semibold mb-2">Upload your floor plan</h3>
        <p className="text-[var(--color-fg-muted)] mb-6 max-w-md mx-auto">
          PNG, JPG, or PDF. AI reads the plan and pulls out every table — label, capacity, and where it sits. You review, you don&apos;t click.
        </p>
        <div className="flex items-center justify-center gap-3">
          <label className="btn btn-primary cursor-pointer">
            <input type="file" accept="image/*,application/pdf" onChange={onPickFile} className="hidden" disabled={uploading} />
            {uploading ? "Processing…" : "Upload & auto-detect"}
          </label>
          {templates.length > 0 && (
            <button className="btn" onClick={() => setShowTemplates(true)}>
              Use template ({templates.length})
            </button>
          )}
        </div>
        {showTemplates && (
          <div className="mt-6 grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
            {templates.map(t => (
              <button key={t.id} onClick={() => handleUseTemplate(t.id)} className="card p-4 text-left hover:border-[var(--color-brand)]">
                <div className="font-semibold">{t.name}</div>
                <div className="text-xs text-[var(--color-fg-muted)]">{t.tableCount} tables</div>
              </button>
            ))}
          </div>
        )}
        {pendingPdf && (
          <PdfConvertModal
            file={pendingPdf}
            onCancel={() => setPendingPdf(null)}
            onDone={(blob) => {
              setPendingPdf(null);
              const f = new File([blob], pendingPdf.name.replace(/\.pdf$/i, ".png"), { type: "image/png" });
              handleUploadImage(f);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <ReviewTable
      eventId={eventId}
      layout={layout}
      onChange={onChange}
      onReplace={() => {
        if (confirm("Replace this layout? AI will re-parse from scratch.")) {
          onChange(null);
        }
      }}
    />
  );
}

function readImageDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = (e) => { reject(e); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function PdfConvertModal({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (blob: Blob) => void }) {
  const [busy, setBusy] = useState(false);

  async function convert() {
    setBusy(true);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
      if (!blob) throw new Error("PDF to image failed");
      onDone(blob);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF conversion failed");
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-5">
      <div className="card p-6 max-w-md w-full">
        <h3 className="text-lg font-semibold mb-2">Convert PDF</h3>
        <p className="text-sm text-[var(--color-fg-muted)] mb-5">
          We&apos;ll render the first page of <code className="text-[var(--color-fg)]">{file.name}</code> as a high-res image, then AI extracts tables.
        </p>
        <div className="flex items-center gap-2">
          <button onClick={convert} disabled={busy} className="btn btn-primary flex-1 h-11">
            {busy ? "Converting…" : "Convert & continue"}
          </button>
          <button onClick={onCancel} disabled={busy} className="btn h-11">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ReviewTable({
  eventId,
  layout,
  onChange,
  onReplace,
}: {
  eventId: string;
  layout: LayoutForTabs;
  onChange: (next: LayoutForTabs | null) => void;
  onReplace: () => void;
}) {
  const [tables, setTables] = useState<TableForTabs[]>(layout.tables);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(tables) !== JSON.stringify(layout.tables);

  function updateTable(idx: number, patch: Partial<TableForTabs>) {
    setTables(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
  }

  async function saveAll() {
    setSaving(true);
    try {
      const persisted = tables.filter(t => t.id);
      const deletedIds = layout.tables
        .filter(orig => orig.id && !persisted.some(p => p.id === orig.id))
        .map(t => t.id!)
        .filter(Boolean);
      const res = await fetch(`/api/events/${eventId}/tables`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tables: persisted.map(t => ({
            id: t.id,
            label: t.label,
            capacity: t.capacity,
            xPct: t.xPct,
            yPct: t.yPct,
            directionsText: t.directionsText,
            notes: t.notes,
          })),
          deleteIds: deletedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Save failed");
      const reloaded: LayoutForTabs = { ...layout, tables: data.tables };
      setTables(reloaded.tables);
      onChange(reloaded);
      toast.success(`Saved ${reloaded.tables.length} tables.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveAsTemplate() {
    const name = prompt("Template name:", layout.name);
    if (!name) return;
    const res = await fetch(`/api/events/${eventId}/layout`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saveAsTemplate: true, templateName: name }),
    });
    if (res.ok) toast.success("Saved as template.");
    else toast.error("Save as template failed.");
  }

  async function generateDirections() {
    if (dirty) { toast.error("Save your edits first."); return; }
    const res = await fetch("/api/ai/wayfinding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not generate"); return; }
    const apply = await fetch(`/api/events/${eventId}/wayfinding/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directions: data.directions }),
    });
    if (!apply.ok) { toast.error("Could not save directions"); return; }
    const map = new Map<string, string>(data.directions.map((d: { tableId: string; directionsText: string }) => [d.tableId, d.directionsText]));
    setTables(prev => prev.map(t => t.id && map.has(t.id) ? { ...t, directionsText: map.get(t.id)! } : t));
    toast.success(`Directions written for ${data.directions.length} tables (${data.source}).`);
  }

  function deleteRow(idx: number) {
    setTables(prev => prev.filter((_, i) => i !== idx));
  }

  const aspect = layout.sourceImageHeight / layout.sourceImageWidth;

  return (
    <div className="space-y-5">
      <div className="card p-4 flex flex-wrap items-center gap-2">
        <div className="text-sm text-[var(--color-fg-muted)] flex-1">
          AI found <strong className="text-[var(--color-fg)]">{layout.tables.length}</strong> tables on your plan. Edit anything below — capacity, label, or directions text. Hit Save when done.
        </div>
        <button onClick={generateDirections} disabled={dirty || tables.length === 0} className="btn h-9 px-3 text-sm">✨ Write directions</button>
        <button onClick={saveAsTemplate} disabled={dirty} className="btn h-9 px-3 text-sm">Save as template</button>
        <button onClick={onReplace} className="btn btn-danger h-9 px-3 text-sm">Replace plan</button>
        <button onClick={saveAll} disabled={!dirty || saving} className="btn btn-primary h-9 px-3 text-sm">
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-5">
        <div className="card overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-[var(--color-border)] text-sm text-[var(--color-fg-muted)]">
            Floor plan reference (read-only)
          </div>
          <div className="relative bg-black" style={{ paddingTop: `${aspect * 100}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={layout.sourceImageUrl} alt="Floor plan" className="absolute inset-0 w-full h-full object-contain" />
            {tables.map((t) => (
              <div
                key={t.id ?? `${t.xPct}-${t.yPct}`}
                className="pin pin-default"
                style={{ left: `${t.xPct}%`, top: `${t.yPct}%`, pointerEvents: "none" }}
                title={`${t.label} (${t.capacity})`}
              >
                {t.label.match(/\d+/)?.[0] ?? "•"}
              </div>
            ))}
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--color-border)] text-sm text-[var(--color-fg-muted)]">
            Tables — review & edit
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Label</th>
                  <th className="text-left px-3 py-2">Cap.</th>
                  <th className="text-left px-3 py-2">Directions</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {tables.map((t, idx) => (
                  <tr key={t.id ?? idx} className="border-t border-[var(--color-border-soft)] hover:bg-[var(--color-bg-elev-2)]">
                    <td className="px-3 py-2 w-[100px]">
                      <input className="input h-9" value={t.label} onChange={e => updateTable(idx, { label: e.target.value })} maxLength={40} />
                    </td>
                    <td className="px-3 py-2 w-[80px]">
                      <input className="input h-9" type="number" min={1} max={40} value={t.capacity} onChange={e => updateTable(idx, { capacity: parseInt(e.target.value || "0", 10) || 0 })} />
                    </td>
                    <td className="px-3 py-2">
                      <input className="input h-9" value={t.directionsText ?? ""} onChange={e => updateTable(idx, { directionsText: e.target.value || null })} placeholder="(optional)" maxLength={200} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => deleteRow(idx)} className="btn btn-danger h-8 px-2 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
                {tables.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-[var(--color-fg-muted)]">No tables. Replace the plan to re-parse.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
