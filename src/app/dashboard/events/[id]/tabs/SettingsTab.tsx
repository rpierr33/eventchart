"use client";

import { useState } from "react";
import { toast } from "sonner";

export type EventForTabs = {
  id: string;
  publicSlug: string;
  allowWalkIns: boolean;
  walkInMode: "AUTO_SEAT" | "REQUIRE_HOST_APPROVAL";
  lookupPrivacy: "PUBLIC" | "CODE_PROTECTED";
  eventCode: string | null;
  status: "DRAFT" | "LIVE" | "ENDED";
  noShowAutoFlagMinutes: number;
};

export default function SettingsTab(props: { event: EventForTabs; onChange: (e: EventForTabs) => void }) {
  const { event, onChange } = props;
  const [saving, setSaving] = useState(false);

  async function patch(data: Partial<EventForTabs>) {
    setSaving(true);
    const res = await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    setSaving(false);
    if (!res.ok) { toast.error("Could not save"); return; }
    const d = await res.json();
    onChange({ ...event, ...d.event });
    toast.success("Saved.");
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <section className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold">Guest lookup privacy</h3>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              Public is fine for casual events. Code-protected for donor dinners, M&amp;A events, sensitive guest lists.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--color-bg-elev-2)]">
            <input type="radio" name="privacy" checked={event.lookupPrivacy === "PUBLIC"} onChange={() => patch({ lookupPrivacy: "PUBLIC" })} className="mt-1" />
            <div>
              <div className="font-medium">Public lookup</div>
              <div className="text-sm text-[var(--color-fg-muted)]">Any guest with the QR can browse by last name.</div>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--color-bg-elev-2)]">
            <input type="radio" name="privacy" checked={event.lookupPrivacy === "CODE_PROTECTED"} onChange={() => patch({ lookupPrivacy: "CODE_PROTECTED" })} className="mt-1" />
            <div>
              <div className="font-medium">Code-protected</div>
              <div className="text-sm text-[var(--color-fg-muted)]">Guests enter a 4-digit code from their invitation first.</div>
            </div>
          </label>
        </div>
        {event.lookupPrivacy === "CODE_PROTECTED" && event.eventCode && (
          <div className="mt-2 p-3 rounded-lg bg-[var(--color-bg-elev-2)] flex items-center justify-between">
            <div>
              <div className="text-xs text-[var(--color-fg-muted)] uppercase tracking-wider">Event code</div>
              <div className="text-2xl font-bold tracking-wider mt-1">{event.eventCode}</div>
            </div>
            <button
              onClick={() => {
                const newCode = prompt("New 4-digit code (or leave empty to randomize):", "");
                if (newCode === null) return;
                const re = /^\d{4}$/;
                if (newCode && !re.test(newCode)) { toast.error("Must be 4 digits"); return; }
                patch({ eventCode: newCode || (Math.floor(Math.random() * 9000) + 1000).toString() });
              }}
              className="btn h-9 text-sm"
            >
              Change
            </button>
          </div>
        )}
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <h3 className="font-semibold">Walk-ins</h3>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">When someone shows up who isn&apos;t on the list.</p>
        </div>
        <label className="flex items-center gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--color-bg-elev-2)]">
          <input
            type="checkbox"
            checked={event.allowWalkIns}
            onChange={(e) => patch({ allowWalkIns: e.target.checked })}
          />
          <div>
            <div className="font-medium">Allow walk-ins</div>
            <div className="text-sm text-[var(--color-fg-muted)]">If off, missing guests get told to find the planner.</div>
          </div>
        </label>
        {event.allowWalkIns && (
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--color-bg-elev-2)]">
              <input type="radio" name="walkInMode" checked={event.walkInMode === "AUTO_SEAT"} onChange={() => patch({ walkInMode: "AUTO_SEAT" })} className="mt-1" />
              <div>
                <div className="font-medium">Auto-seat walk-ins</div>
                <div className="text-sm text-[var(--color-fg-muted)]">First open seat. Fastest for casual events.</div>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-[var(--color-bg-elev-2)]">
              <input type="radio" name="walkInMode" checked={event.walkInMode === "REQUIRE_HOST_APPROVAL"} onChange={() => patch({ walkInMode: "REQUIRE_HOST_APPROVAL" })} className="mt-1" />
              <div>
                <div className="font-medium">Require host approval</div>
                <div className="text-sm text-[var(--color-fg-muted)]">Walk-ins go in a queue. You approve or decline from the live view.</div>
              </div>
            </label>
          </div>
        )}
      </section>

      <section className="card p-5 space-y-3">
        <div>
          <h3 className="font-semibold">No-show flagging</h3>
          <p className="text-sm text-[var(--color-fg-muted)] mt-1">After this many minutes from event start, unscanned guests are flagged red on the live view.</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            className="input max-w-[140px]"
            min={5}
            max={240}
            value={event.noShowAutoFlagMinutes}
            onChange={e => onChange({ ...event, noShowAutoFlagMinutes: parseInt(e.target.value || "45", 10) })}
            onBlur={e => patch({ noShowAutoFlagMinutes: parseInt(e.target.value || "45", 10) })}
          />
          <span className="text-sm text-[var(--color-fg-muted)]">minutes</span>
        </div>
      </section>

      {saving && <p className="text-xs text-[var(--color-fg-muted)]">Saving…</p>}
    </div>
  );
}
