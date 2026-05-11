"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { toast } from "sonner";

// Polygon-mode section editor. Self-contained component, ships if glitchless.
//
// Interaction model (single mode at a time, surfaced via a small toolbar):
//   • Select   — click on a section to select it; click again on a vertex to drag it; click outside to deselect.
//   • Draw     — click to drop vertices in order. Double-click or "Finish" closes the polygon.
//   • Erase    — click a section to delete it.
//
// Coordinates are stored as xPct/yPct (0..100) so the polygon scales with the image.
// Tables whose center falls inside a polygon get auto-assigned to that section on save.

type Pt = { x: number; y: number };
type SectionLite = {
  id?: string;       // server id once persisted
  tmpId: string;     // client-stable id for editing
  label: string;
  color?: string | null;
  polygon: Pt[];     // [{x: pct, y: pct}, ...]
  centroid: Pt;      // computed
};
type TableLite = { id: string; label: string; xPct: number; yPct: number };

const COLORS = ["#8B6F47", "#5E8B5C", "#406682", "#B58234", "#A8443A", "#7C5A8C", "#3F7A78", "#9B6B4A"];

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  // Ray-casting algorithm. Works for non-convex polygons. Returns boolean.
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > p.y) !== (yj > p.y))
      && (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function centroidOf(poly: Pt[]): Pt {
  if (poly.length === 0) return { x: 50, y: 50 };
  let sx = 0, sy = 0;
  for (const p of poly) { sx += p.x; sy += p.y; }
  return { x: sx / poly.length, y: sy / poly.length };
}

export default function SectionPolygonEditor({
  eventId,
  layoutId: _layoutId,
  layoutImageUrl,
  layoutWidth,
  layoutHeight,
  existingSections,
  tables,
  onClose,
  onSaved,
}: {
  eventId: string;
  layoutId: string;
  layoutImageUrl: string;
  layoutWidth: number;
  layoutHeight: number;
  existingSections: Array<{ id: string; label: string; xPct: number; yPct: number; color?: string | null; polygon?: Pt[] | null }>;
  tables: TableLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Seed local state from props. Sections without a polygon get a tiny default
  // polygon around their centroid so the planner can drag instead of starting from zero.
  const initial: SectionLite[] = useMemo(() => existingSections.map((s, i) => {
    const poly = Array.isArray(s.polygon) && s.polygon.length >= 3
      ? s.polygon.map(p => ({ x: p.x, y: p.y }))
      : seedSquareAround({ x: s.xPct, y: s.yPct }, 10);
    return {
      id: s.id,
      tmpId: s.id,
      label: s.label,
      color: s.color ?? COLORS[i % COLORS.length],
      polygon: poly,
      centroid: centroidOf(poly),
    };
  }), [existingSections]);

  const [sections, setSections] = useState<SectionLite[]>(initial);
  const [mode, setMode] = useState<"select" | "draw" | "erase">("select");
  const [drawing, setDrawing] = useState<Pt[]>([]);
  const [drawLabel, setDrawLabel] = useState("");
  const [selectedTmpId, setSelectedTmpId] = useState<string | null>(null);
  const [dragVertex, setDragVertex] = useState<{ tmpId: string; index: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const imgRef = useRef<HTMLDivElement>(null);
  const aspect = layoutHeight / layoutWidth;

  function pctFromEvent(e: { clientX: number; clientY: number }): Pt {
    if (!imgRef.current) return { x: 50, y: 50 };
    const rect = imgRef.current.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100)),
    };
  }

  function handlePlaneClick(e: React.MouseEvent<HTMLDivElement>) {
    if (mode === "draw") {
      const p = pctFromEvent(e);
      // Close polygon if click is near the first vertex (only after 3+ vertices)
      if (drawing.length >= 3) {
        const first = drawing[0];
        const dx = p.x - first.x;
        const dy = p.y - first.y;
        const distPct = Math.hypot(dx, dy);
        if (distPct < 3.5) {
          finishDrawing();
          return;
        }
      }
      setDrawing(prev => [...prev, p]);
      return;
    }
    if (mode === "select") {
      // Click outside any polygon deselects
      const p = pctFromEvent(e);
      const hit = sections.find(s => pointInPolygon(p, s.polygon));
      setSelectedTmpId(hit?.tmpId ?? null);
    }
  }

  function finishDrawing() {
    if (drawing.length < 3) {
      toast.error("Need at least 3 points to make a section.");
      return;
    }
    const label = drawLabel.trim() || `Section ${sections.length + 1}`;
    const next: SectionLite = {
      tmpId: `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      color: COLORS[sections.length % COLORS.length],
      polygon: drawing,
      centroid: centroidOf(drawing),
    };
    setSections(prev => [...prev, next]);
    setDrawing([]);
    setDrawLabel("");
    setMode("select");
    setSelectedTmpId(next.tmpId);
  }

  function cancelDrawing() {
    setDrawing([]);
    setDrawLabel("");
    setMode("select");
  }

  function startVertexDrag(e: React.PointerEvent, tmpId: string, idx: number) {
    e.stopPropagation();
    setDragVertex({ tmpId, index: idx });
    setSelectedTmpId(tmpId);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragVertex) return;
    const p = pctFromEvent(e);
    setSections(prev => prev.map(s => {
      if (s.tmpId !== dragVertex.tmpId) return s;
      const newPoly = s.polygon.map((vp, i) => (i === dragVertex.index ? p : vp));
      return { ...s, polygon: newPoly, centroid: centroidOf(newPoly) };
    }));
  }

  function handlePointerUp() {
    setDragVertex(null);
  }

  function deleteVertex(tmpId: string, idx: number) {
    setSections(prev => prev.map(s => {
      if (s.tmpId !== tmpId) return s;
      if (s.polygon.length <= 3) {
        toast.error("Sections need at least 3 vertices — delete the whole section instead.");
        return s;
      }
      const newPoly = s.polygon.filter((_, i) => i !== idx);
      return { ...s, polygon: newPoly, centroid: centroidOf(newPoly) };
    }));
  }

  function deleteSection(tmpId: string) {
    setSections(prev => prev.filter(s => s.tmpId !== tmpId));
    setSelectedTmpId(null);
  }

  function renameSection(tmpId: string, label: string) {
    setSections(prev => prev.map(s => s.tmpId === tmpId ? { ...s, label } : s));
  }

  // Tables that fall inside each polygon — used both for visual highlight and for save.
  const tableAssignments = useMemo(() => {
    const map = new Map<string, string | null>(); // tableId → section tmpId
    for (const t of tables) {
      const hit = sections.find(s => pointInPolygon({ x: t.xPct, y: t.yPct }, s.polygon));
      map.set(t.id, hit?.tmpId ?? null);
    }
    return map;
  }, [sections, tables]);

  async function save() {
    setSaving(true);
    try {
      // Build the API payload. We need section ids back from PUT to map tableAssignments.
      // Strategy: PUT once with replace=true to upsert all sections (server matches by id if present, label otherwise).
      // Then re-fetch the resulting ids and map our local tmpId → server id, then send tableAssignments in a second PUT.
      const initialPayload = {
        sections: sections.map(s => ({
          id: s.id,         // may be undefined for newly drawn
          label: s.label,
          xPct: s.centroid.x,
          yPct: s.centroid.y,
          color: s.color ?? null,
          polygon: s.polygon.map(p => ({ x: p.x, y: p.y })),
        })),
        replace: true,
      };
      const res1 = await fetch(`/api/events/${eventId}/sections`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(initialPayload),
      });
      if (!res1.ok) { toast.error("Could not save sections"); return; }
      const data1 = await res1.json();
      const serverSections: Array<{ id: string; label: string }> = data1.sections;

      // Map local tmpId → server id. For sections with an existing s.id, that already matches.
      // For new ones, server picked the id when it created — match by label (server matches case-insensitively).
      const labelToId = new Map(serverSections.map(s => [s.label.toLowerCase(), s.id]));
      const localToServer = new Map<string, string>();
      for (const s of sections) {
        const sid = s.id ?? labelToId.get(s.label.toLowerCase());
        if (sid) localToServer.set(s.tmpId, sid);
      }

      // Build table assignment map (tableId → server sectionId | null)
      const assignments: Record<string, string | null> = {};
      for (const [tableId, tmpId] of tableAssignments) {
        assignments[tableId] = tmpId ? (localToServer.get(tmpId) ?? null) : null;
      }
      if (Object.keys(assignments).length > 0) {
        const res2 = await fetch(`/api/events/${eventId}/sections`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sections: initialPayload.sections,
            tableAssignments: assignments,
          }),
        });
        if (!res2.ok) { toast.error("Sections saved but table assignment failed"); return; }
      }

      toast.success(`Saved ${sections.length} section${sections.length !== 1 ? "s" : ""}.`);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-[var(--color-overlay)] z-50 flex flex-col" onClick={onClose}>
      <div className="card max-w-5xl w-full mx-auto my-6 flex-1 max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-[18px] font-medium tracking-tight">Draw sections on the floor plan</h3>
            <p className="text-[13px] text-[var(--color-fg-muted)] mt-0.5">Tables that fall inside a section get auto-assigned to it.</p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-[var(--color-surface-2)] rounded-md">
            <button onClick={() => { setMode("select"); cancelDrawing(); }} className={`h-9 px-3 rounded-md text-[13px] font-medium ${mode === "select" ? "bg-[var(--color-surface)] shadow-sm" : "text-[var(--color-fg-muted)]"}`}>↖ Select</button>
            <button onClick={() => { setMode("draw"); setDrawing([]); }} className={`h-9 px-3 rounded-md text-[13px] font-medium ${mode === "draw" ? "bg-[var(--color-surface)] shadow-sm" : "text-[var(--color-fg-muted)]"}`}>✎ Draw</button>
            <button onClick={() => { setMode("erase"); cancelDrawing(); }} className={`h-9 px-3 rounded-md text-[13px] font-medium ${mode === "erase" ? "bg-[var(--color-surface)] shadow-sm" : "text-[var(--color-fg-muted)]"}`}>✕ Erase</button>
          </div>
        </div>

        {mode === "draw" && (
          <div className="px-4 py-2 bg-[var(--color-accent-soft)] text-[13px] flex items-center gap-3 border-b border-[var(--color-border-soft)]">
            <input
              autoFocus
              className="input h-9 max-w-xs"
              placeholder="Section name (e.g. VIP, Family)"
              value={drawLabel}
              onChange={e => setDrawLabel(e.target.value)}
            />
            <span className="text-[var(--color-fg-muted)]">
              {drawing.length === 0 ? "Click to drop the first vertex." : `${drawing.length} vertex${drawing.length === 1 ? "" : "es"} — click near the first to close, or use Finish.`}
            </span>
            <div className="flex-1" />
            <button onClick={finishDrawing} disabled={drawing.length < 3} className="btn btn-primary h-9 text-[13px]">Finish</button>
            <button onClick={cancelDrawing} className="btn h-9 text-[13px]">Cancel</button>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 bg-[var(--color-surface-2)]">
          <div
            ref={imgRef}
            onClick={handlePlaneClick}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative bg-white border border-[var(--color-border)] rounded-lg overflow-hidden mx-auto"
            style={{
              maxWidth: 1100,
              paddingTop: `${aspect * 100}%`,
              cursor: mode === "draw" ? "crosshair" : mode === "erase" ? "not-allowed" : "default",
              touchAction: "none",
              userSelect: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={layoutImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />

            {/* Section polygons (existing + being drawn) */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {sections.map(s => {
                const isSelected = s.tmpId === selectedTmpId;
                const fillRgb = colorToRgba(s.color ?? "#8B6F47", isSelected ? 0.30 : 0.15);
                const strokeRgb = colorToRgba(s.color ?? "#8B6F47", 1);
                const points = s.polygon.map(p => `${p.x},${p.y}`).join(" ");
                return (
                  <g key={s.tmpId}>
                    <polygon
                      points={points}
                      fill={fillRgb}
                      stroke={strokeRgb}
                      strokeWidth={isSelected ? "0.6" : "0.4"}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      style={{ pointerEvents: "auto", cursor: mode === "erase" ? "not-allowed" : "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (mode === "erase") { deleteSection(s.tmpId); return; }
                        setSelectedTmpId(s.tmpId);
                      }}
                    />
                    <text
                      x={s.centroid.x}
                      y={s.centroid.y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize="2.2"
                      fontWeight="600"
                      fill={strokeRgb}
                      style={{ pointerEvents: "none" }}
                    >
                      {s.label}
                    </text>
                  </g>
                );
              })}
              {/* Drawing-in-progress polyline */}
              {mode === "draw" && drawing.length > 0 && (
                <polyline
                  points={drawing.map(p => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="0.4"
                  strokeDasharray="1 1"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </svg>

            {/* Vertex handles for the selected section */}
            {mode === "select" && selectedTmpId && (() => {
              const s = sections.find(x => x.tmpId === selectedTmpId);
              if (!s) return null;
              return s.polygon.map((p, i) => (
                <button
                  key={i}
                  onPointerDown={(e) => startVertexDrag(e, s.tmpId, i)}
                  onContextMenu={(e) => { e.preventDefault(); deleteVertex(s.tmpId, i); }}
                  className="absolute rounded-full border-2 border-white shadow-md"
                  style={{
                    left: `${p.x}%`,
                    top: `${p.y}%`,
                    transform: "translate(-50%, -50%)",
                    width: 14,
                    height: 14,
                    background: s.color ?? "#8B6F47",
                    cursor: "grab",
                  }}
                  title="Drag to move · right-click to remove"
                />
              ));
            })()}

            {/* Draw-mode vertex dots (visual) */}
            {mode === "draw" && drawing.map((p, i) => (
              <div
                key={i}
                className="absolute w-2 h-2 rounded-full bg-[var(--color-accent)] border border-white"
                style={{ left: `${p.x}%`, top: `${p.y}%`, transform: "translate(-50%, -50%)", pointerEvents: "none" }}
              />
            ))}

            {/* Tables */}
            {tables.map(t => {
              const assignedTmpId = tableAssignments.get(t.id);
              const assignedColor = assignedTmpId ? sections.find(s => s.tmpId === assignedTmpId)?.color : null;
              return (
                <div
                  key={t.id}
                  className="absolute rounded-full border-2 border-white shadow-sm flex items-center justify-center font-semibold"
                  style={{
                    left: `${t.xPct}%`,
                    top: `${t.yPct}%`,
                    transform: "translate(-50%, -50%)",
                    width: 22,
                    height: 22,
                    fontSize: 9,
                    color: "#fff",
                    background: assignedColor ?? "#9E9A91",
                    pointerEvents: "none",
                  }}
                  title={t.label}
                >
                  {t.label.match(/\d+/)?.[0] ?? "•"}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right rail / side info */}
        {selectedTmpId && mode === "select" && (() => {
          const s = sections.find(x => x.tmpId === selectedTmpId);
          if (!s) return null;
          const memberCount = [...tableAssignments.values()].filter(t => t === selectedTmpId).length;
          return (
            <div className="p-4 border-t border-[var(--color-border)] flex items-center gap-3 flex-wrap bg-[var(--color-surface)]">
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-sm" style={{ background: s.color ?? "#8B6F47" }} />
                <input
                  className="input h-9 max-w-xs"
                  value={s.label}
                  onChange={(e) => renameSection(s.tmpId, e.target.value)}
                  maxLength={40}
                />
              </div>
              <span className="text-[13px] text-[var(--color-fg-muted)]">
                {memberCount} table{memberCount !== 1 ? "s" : ""} inside · {s.polygon.length} vertices
              </span>
              <div className="flex-1" />
              <button onClick={() => deleteSection(s.tmpId)} className="btn btn-danger h-9 text-[13px]">Delete section</button>
            </div>
          );
        })()}

        <div className="p-4 border-t border-[var(--color-border)] flex items-center gap-2 bg-[var(--color-surface)]">
          <span className="text-[13px] text-[var(--color-fg-muted)] flex-1">
            {sections.length} section{sections.length !== 1 ? "s" : ""} · {[...tableAssignments.values()].filter(Boolean).length}/{tables.length} tables assigned
          </span>
          <button onClick={save} disabled={saving} className="btn btn-primary h-10 text-[14px]">
            {saving ? "Saving…" : "Save sections"}
          </button>
          <button onClick={onClose} disabled={saving} className="btn h-10 text-[14px]">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function seedSquareAround(c: Pt, half: number): Pt[] {
  const lo = (v: number, d: number) => Math.max(0, v - d);
  const hi = (v: number, d: number) => Math.min(100, v + d);
  return [
    { x: lo(c.x, half), y: lo(c.y, half) },
    { x: hi(c.x, half), y: lo(c.y, half) },
    { x: hi(c.x, half), y: hi(c.y, half) },
    { x: lo(c.x, half), y: hi(c.y, half) },
  ];
}

function colorToRgba(hex: string, alpha: number): string {
  // Accepts #RGB or #RRGGBB
  const clean = hex.replace("#", "");
  const r = parseInt(clean.length === 3 ? clean[0] + clean[0] : clean.slice(0, 2), 16);
  const g = parseInt(clean.length === 3 ? clean[1] + clean[1] : clean.slice(2, 4), 16);
  const b = parseInt(clean.length === 3 ? clean[2] + clean[2] : clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
