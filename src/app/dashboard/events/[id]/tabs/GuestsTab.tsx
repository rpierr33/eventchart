"use client";

import { useState, useMemo, useRef } from "react";
import { toast } from "sonner";
import Papa from "papaparse";
import { arrayBufferToBase64 } from "@/lib/utils";

export type GuestForTabs = {
  id: string;
  firstName: string;
  lastName: string;
  assignedTableId: string | null;
  groupTag: string | null;
  plusOneOfGuestId: string | null;
  isPlusOnePlaceholder: boolean;
  notes: string | null;
};

export default function GuestsTab(props: {
  eventId: string;
  guests: GuestForTabs[];
  onChange: (next: GuestForTabs[]) => void;
}) {
  const { eventId, guests, onChange } = props;
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [editing, setEditing] = useState<GuestForTabs | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return guests;
    return guests.filter(g =>
      `${g.firstName} ${g.lastName}`.toLowerCase().includes(needle) ||
      (g.groupTag ?? "").toLowerCase().includes(needle)
    );
  }, [guests, q]);

  async function reload() {
    const res = await fetch(`/api/events/${eventId}/guests`);
    const data = await res.json();
    if (res.ok) onChange(data.guests);
  }

  async function deleteGuest(id: string) {
    if (!confirm("Remove this guest?")) return;
    const res = await fetch(`/api/events/${eventId}/guests/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("Removed"); reload(); }
    else toast.error("Could not remove");
  }

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileUpload(file: File) {
    setUploading(true);
    toast.info("AI is reading your guest list…");
    try {
      let parseBody: object;
      const isImage = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(file.type);
      const isPdf = file.type === "application/pdf";
      const isText = !isImage && !isPdf;

      if (isImage) {
        const mediaType = file.type === "image/jpg" ? "image/jpeg" : file.type;
        const b64 = arrayBufferToBase64(await file.arrayBuffer());
        parseBody = { imageBase64: b64, mediaType };
      } else if (isPdf) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
        const buf = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buf }).promise;
        // Concatenate text from all pages
        let allText = "";
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          const pageText = content.items.map((item) => "str" in item ? item.str : "").join(" ");
          allText += pageText + "\n";
        }
        if (allText.trim().length < 20) {
          // Likely scanned PDF — render first page as image and use vision
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 0.92));
          if (!blob) throw new Error("PDF render failed");
          const b64 = arrayBufferToBase64(await blob.arrayBuffer());
          parseBody = { imageBase64: b64, mediaType: "image/png" };
        } else {
          parseBody = { text: allText };
        }
      } else if (isText) {
        const text = await file.text();
        parseBody = { text };
      } else {
        toast.error("Unsupported file type");
        return;
      }

      const res = await fetch("/api/ai/parse-guests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parseBody),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "AI parse failed");
      const list = Array.isArray(data.guests) ? data.guests : [];
      if (list.length === 0) { toast.warning("No guests found"); return; }

      const saveRes = await fetch(`/api/events/${eventId}/guests/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guests: list }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData?.error ?? "Save failed");
      toast.success(`Imported ${saveData.count} guests. ${saveData.assigned} auto-seated.`);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Search guests…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="flex-1" />
        <input
          type="file"
          accept="image/*,application/pdf,.csv,.txt,.tsv"
          ref={fileRef}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ""; }}
          className="hidden"
        />
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn btn-primary h-10 text-sm">
          {uploading ? "Reading…" : "📎 Upload guest list (AI)"}
        </button>
        <button onClick={() => setShowAI(true)} className="btn h-10 text-sm">✨ Paste text</button>
        <button onClick={() => setShowImport(true)} className="btn h-10 text-sm">CSV mapper</button>
        <button onClick={() => setShowAdd(true)} className="btn h-10 text-sm">+ Manual</button>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-10 text-center">
          <div className="text-4xl mb-3">👥</div>
          <h3 className="font-semibold text-lg mb-1">No guests yet</h3>
          <p className="text-[var(--color-fg-muted)] text-sm mb-5">Add manually, upload a CSV, or paste a messy list and let AI clean it up.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">Group</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id} className="border-t border-[var(--color-border-soft)] hover:bg-[var(--color-bg-elev-2)]">
                  <td className="px-4 py-3">
                    <div className="font-medium">{g.firstName} {g.lastName}</div>
                    {g.plusOneOfGuestId && (
                      <div className="text-xs text-[var(--color-fg-muted)]">
                        +1 of {guests.find(h => h.id === g.plusOneOfGuestId)?.firstName ?? "host"}
                      </div>
                    )}
                    {g.isPlusOnePlaceholder && (
                      <span className="badge badge-yellow ml-1">TBD</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {g.groupTag ? <span className="badge badge-blue">{g.groupTag}</span> : <span className="text-[var(--color-fg-faint)]">—</span>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-[var(--color-fg-muted)] max-w-[300px] truncate">
                    {g.notes ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(g)} className="btn h-8 px-3 text-xs">Edit</button>
                    <button onClick={() => deleteGuest(g.id)} className="btn btn-danger h-8 px-3 text-xs ml-2">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdd && <AddGuestModal eventId={eventId} guests={guests} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); reload(); }} />}
      {editing && <AddGuestModal eventId={eventId} guests={guests} editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {showImport && <CsvImportModal eventId={eventId} onClose={() => setShowImport(false)} onSaved={() => { setShowImport(false); reload(); }} />}
      {showAI && <AIImportModal eventId={eventId} onClose={() => setShowAI(false)} onSaved={() => { setShowAI(false); reload(); }} />}
    </div>
  );
}

function AddGuestModal({ eventId, guests, editing, onClose, onSaved }: {
  eventId: string;
  guests: GuestForTabs[];
  editing?: GuestForTabs;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const isPlusOne = fd.get("isPlusOne") === "on";
    const plusOneOf = fd.get("plusOneOf") as string | null;
    const isPlaceholder = fd.get("isPlaceholder") === "on";

    const payload: Record<string, unknown> = {
      firstName: String(fd.get("firstName") ?? "").trim(),
      lastName: String(fd.get("lastName") ?? "").trim(),
      groupTag: (String(fd.get("groupTag") ?? "").trim() || null),
      notes: (String(fd.get("notes") ?? "").trim() || null),
      plusOneOfGuestId: isPlusOne ? plusOneOf || null : null,
      isPlusOnePlaceholder: isPlusOne && isPlaceholder,
    };

    const url = editing ? `/api/events/${eventId}/guests/${editing.id}` : `/api/events/${eventId}/guests`;
    const method = editing ? "PATCH" : "POST";
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error ?? "Save failed");
      return;
    }
    toast.success(editing ? "Updated" : "Added");
    onSaved();
  }

  return (
    <Modal onClose={onClose} title={editing ? "Edit guest" : "Add guest"}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">First name</label>
            <input name="firstName" className="input" required defaultValue={editing?.firstName} maxLength={40} />
          </div>
          <div>
            <label className="label">Last name</label>
            <input name="lastName" className="input" required defaultValue={editing?.lastName} maxLength={40} />
          </div>
        </div>
        <div>
          <label className="label">Group tag (optional)</label>
          <input name="groupTag" className="input" defaultValue={editing?.groupTag ?? ""} placeholder="Bride's Family, Marketing Team, VIP" maxLength={40} />
        </div>
        <div>
          <label className="label">Notes (dietary, accessibility, VIP…)</label>
          <textarea name="notes" className="input min-h-[80px]" defaultValue={editing?.notes ?? ""} maxLength={400} />
        </div>
        <details>
          <summary className="cursor-pointer text-sm text-[var(--color-fg-muted)]">Plus-one settings</summary>
          <div className="mt-3 space-y-2 p-3 rounded-lg bg-[var(--color-bg-elev-2)]">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPlusOne" defaultChecked={!!editing?.plusOneOfGuestId} />
              This guest is a plus-one of another guest
            </label>
            <select name="plusOneOf" className="input">
              <option value="">— Select host —</option>
              {guests.filter(g => g.id !== editing?.id && !g.plusOneOfGuestId).map(g => (
                <option key={g.id} value={g.id} selected={editing?.plusOneOfGuestId === g.id}>
                  {g.firstName} {g.lastName}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPlaceholder" defaultChecked={editing?.isPlusOnePlaceholder} />
              Name unknown (placeholder &quot;+1 TBD&quot;)
            </label>
          </div>
        </details>
        <div className="flex items-center gap-2 pt-2">
          <button type="submit" disabled={saving} className="btn btn-primary flex-1 h-11">{saving ? "Saving…" : editing ? "Save" : "Add"}</button>
          <button type="button" onClick={onClose} className="btn h-11">Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function CsvImportModal({ eventId, onClose, onSaved }: { eventId: string; onClose: () => void; onSaved: () => void }) {
  type Row = Record<string, string>;
  const [parsed, setParsed] = useState<Row[] | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<{ firstName: string; lastName: string; groupTag: string; notes: string }>({
    firstName: "", lastName: "", groupTag: "", notes: "",
  });
  const [saving, setSaving] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data;
        const heads = results.meta.fields ?? Object.keys(data[0] ?? {});
        setHeaders(heads);
        setParsed(data);
        // Auto-detect mapping
        const lower = heads.map(h => h.toLowerCase());
        const find = (...needles: string[]) => heads[lower.findIndex(h => needles.some(n => h.includes(n)))] ?? "";
        setMapping({
          firstName: find("first", "given") || heads[0] || "",
          lastName: find("last", "surname", "family") || heads[1] || "",
          groupTag: find("group", "table", "category"),
          notes: find("note", "dietary", "comment"),
        });
      },
      error: () => toast.error("Could not read CSV"),
    });
  }

  async function commit() {
    if (!parsed) return;
    if (!mapping.firstName && !mapping.lastName) {
      toast.error("Pick at least one name column"); return;
    }
    setSaving(true);
    const rows = parsed.map(r => ({
      firstName: (r[mapping.firstName] ?? "").trim(),
      lastName: (r[mapping.lastName] ?? "").trim(),
      groupTag: mapping.groupTag ? (r[mapping.groupTag] ?? "").trim() || null : null,
      notes: mapping.notes ? (r[mapping.notes] ?? "").trim() || null : null,
    })).filter(r => r.firstName || r.lastName);
    // Split "Mr. and Mrs. Smith" → two records
    const expanded: typeof rows = [];
    for (const r of rows) {
      const text = `${r.firstName} ${r.lastName}`.trim();
      if (/(\bMr\.?\s+and\s+Mrs\.?|\bMr\.?\s*&\s*Mrs\.?)/i.test(text)) {
        const last = (text.match(/Mrs\.?\s+([A-Za-z\-']+)/i)?.[1] || r.lastName).trim();
        expanded.push({ firstName: "Mr.", lastName: last, groupTag: r.groupTag, notes: r.notes });
        expanded.push({ firstName: "Mrs.", lastName: last, groupTag: r.groupTag, notes: r.notes });
      } else {
        // If lastName empty and firstName looks like "John Smith", split
        if (!r.lastName && r.firstName.includes(" ")) {
          const parts = r.firstName.split(/\s+/);
          expanded.push({ firstName: parts[0], lastName: parts.slice(1).join(" "), groupTag: r.groupTag, notes: r.notes });
        } else {
          expanded.push(r);
        }
      }
    }

    const res = await fetch(`/api/events/${eventId}/guests/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guests: expanded }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data?.error ?? "Import failed"); return;
    }
    const data = await res.json();
    toast.success(`Imported ${data.count} guests.`);
    onSaved();
  }

  return (
    <Modal onClose={onClose} title="Import guests from CSV" wide>
      {!parsed ? (
        <div className="space-y-3 text-sm">
          <p className="text-[var(--color-fg-muted)]">
            Pick any CSV. We&apos;ll auto-detect the columns. You can fix the mapping in the next step.
          </p>
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="input" />
          <p className="text-xs text-[var(--color-fg-faint)]">
            Tip: &quot;Mr. and Mrs. Smith&quot;-style rows will be auto-split into two records.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {(["firstName", "lastName", "groupTag", "notes"] as const).map(field => (
              <div key={field}>
                <label className="label">{({
                  firstName: "First name column",
                  lastName: "Last name column",
                  groupTag: "Group tag column (optional)",
                  notes: "Notes column (optional)",
                } as const)[field]}</label>
                <select
                  className="input"
                  value={mapping[field]}
                  onChange={e => setMapping({ ...mapping, [field]: e.target.value })}
                >
                  <option value="">—</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="card overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="text-[var(--color-fg-muted)]">
                <tr>
                  <th className="text-left px-3 py-2">First</th>
                  <th className="text-left px-3 py-2">Last</th>
                  <th className="text-left px-3 py-2">Group</th>
                  <th className="text-left px-3 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {parsed.slice(0, 50).map((r, i) => (
                  <tr key={i} className="border-t border-[var(--color-border-soft)]">
                    <td className="px-3 py-2">{r[mapping.firstName] ?? ""}</td>
                    <td className="px-3 py-2">{r[mapping.lastName] ?? ""}</td>
                    <td className="px-3 py-2">{mapping.groupTag ? r[mapping.groupTag] : ""}</td>
                    <td className="px-3 py-2 truncate max-w-[200px]">{mapping.notes ? r[mapping.notes] : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--color-fg-faint)]">{parsed.length} row{parsed.length !== 1 ? "s" : ""} found{parsed.length > 50 ? " (showing first 50)" : ""}</p>
          <div className="flex items-center gap-2 pt-2">
            <button onClick={commit} disabled={saving} className="btn btn-primary flex-1 h-11">{saving ? "Importing…" : `Import ${parsed.length}`}</button>
            <button onClick={onClose} className="btn h-11">Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function AIImportModal({ eventId, onClose, onSaved }: { eventId: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  type Parsed = { firstName: string; lastName: string; groupTag?: string | null; notes?: string | null; plusOneOf?: string | null; isPlaceholder?: boolean };
  const [draft, setDraft] = useState<Parsed[] | null>(null);

  async function parse() {
    if (!text.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/ai/parse-guests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "AI parse failed"); return; }
    setDraft(data.guests);
  }

  async function commit() {
    if (!draft) return;
    setBusy(true);
    const res = await fetch(`/api/events/${eventId}/guests/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guests: draft }),
    });
    setBusy(false);
    if (!res.ok) { toast.error("Save failed"); return; }
    const data = await res.json();
    toast.success(`Imported ${data.count} guests.`);
    onSaved();
  }

  return (
    <Modal onClose={onClose} title="Paste any messy guest list" wide>
      {!draft ? (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-fg-muted)]">
            Paste from an email, Word doc, or text dump. We&apos;ll parse names, plus-ones, group tags, and notes.
            You review and edit before saving — AI doesn&apos;t auto-commit anything.
          </p>
          <textarea className="input min-h-[200px] font-mono text-sm" value={text} onChange={e => setText(e.target.value)} placeholder="Bride's Family:&#10;Mr. and Mrs. Pierre&#10;John Smith (vegetarian)&#10;&#10;Groom's Family:&#10;Mary Wilson +1 TBD&#10;..." />
          <div className="flex items-center gap-2">
            <button onClick={parse} disabled={busy || !text.trim()} className="btn btn-primary flex-1 h-11">{busy ? "Parsing…" : "✨ Parse with AI"}</button>
            <button onClick={onClose} className="btn h-11">Cancel</button>
          </div>
          <p className="text-xs text-[var(--color-fg-faint)]">Requires <code>ANTHROPIC_API_KEY</code> on the server.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[var(--color-fg-muted)]">{draft.length} guest{draft.length !== 1 ? "s" : ""} parsed. Edit before saving.</p>
          <div className="card overflow-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="text-xs text-[var(--color-fg-muted)] uppercase">
                <tr>
                  <th className="text-left px-3 py-2">First</th>
                  <th className="text-left px-3 py-2">Last</th>
                  <th className="text-left px-3 py-2">Group</th>
                  <th className="text-left px-3 py-2">Notes</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {draft.map((g, i) => (
                  <tr key={i} className="border-t border-[var(--color-border-soft)]">
                    <td className="px-3 py-1"><input className="input h-9" value={g.firstName} onChange={e => setDraft(prev => prev!.map((r, j) => j === i ? { ...r, firstName: e.target.value } : r))} /></td>
                    <td className="px-3 py-1"><input className="input h-9" value={g.lastName} onChange={e => setDraft(prev => prev!.map((r, j) => j === i ? { ...r, lastName: e.target.value } : r))} /></td>
                    <td className="px-3 py-1"><input className="input h-9" value={g.groupTag ?? ""} onChange={e => setDraft(prev => prev!.map((r, j) => j === i ? { ...r, groupTag: e.target.value || null } : r))} /></td>
                    <td className="px-3 py-1"><input className="input h-9" value={g.notes ?? ""} onChange={e => setDraft(prev => prev!.map((r, j) => j === i ? { ...r, notes: e.target.value || null } : r))} /></td>
                    <td className="px-3 py-1 text-right"><button onClick={() => setDraft(prev => prev!.filter((_, j) => j !== i))} className="btn btn-danger h-8 px-2 text-xs">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={commit} disabled={busy} className="btn btn-primary flex-1 h-11">{busy ? "Saving…" : `Save ${draft.length} guests`}</button>
            <button onClick={() => setDraft(null)} className="btn h-11">Back</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Modal({ children, onClose, title, wide }: { children: React.ReactNode; onClose: () => void; title: string; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`card p-6 w-full ${wide ? "max-w-3xl" : "max-w-md"} max-h-[90vh] overflow-auto`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="btn btn-ghost h-8 w-8 p-0">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
