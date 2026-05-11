"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useMemo, useCallback } from "react";
import LayoutTab, { type LayoutForTabs, type TemplateOption } from "./tabs/LayoutTab";
import GuestsTab, { type GuestForTabs } from "./tabs/GuestsTab";
import AssignTab from "./tabs/AssignTab";
import QRTab, { type QRForTabs } from "./tabs/QRTab";
import SettingsTab, { type EventForTabs } from "./tabs/SettingsTab";

const TABS = [
  { key: "layout", label: "Layout" },
  { key: "guests", label: "Guests" },
  { key: "assign", label: "Assign" },
  { key: "qr", label: "QR codes" },
  { key: "settings", label: "Settings" },
] as const;
type TabKey = typeof TABS[number]["key"];

export default function EventSetupTabs(props: {
  initialTab: string;
  event: EventForTabs;
  layout: LayoutForTabs | null;
  guests: GuestForTabs[];
  qrCodes: QRForTabs[];
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const initial = (TABS.find(t => t.key === props.initialTab)?.key ?? "layout") as TabKey;
  const [tab, setTab] = useState<TabKey>(initial);

  const [event, setEvent] = useState(props.event);
  const [layout, setLayout] = useState(props.layout);
  const [guests, setGuests] = useState(props.guests);
  const [qrCodes, setQrCodes] = useState(props.qrCodes);

  const switchTab = useCallback((next: TabKey) => {
    setTab(next);
    const sp = new URLSearchParams(params.toString());
    sp.set("tab", next);
    router.replace(`?${sp.toString()}`, { scroll: false });
  }, [params, router]);

  const reloadFromServer = useCallback(async () => {
    // Refresh state from /state which has the canonical post-write view.
    // Server-render via router.refresh() also fires so server components rerender.
    try {
      const r = await fetch(`/api/events/${event.id}/state`);
      if (r.ok) {
        const s = await r.json();
        if (s.qrCodes) setQrCodes(s.qrCodes);
        if (s.guests) setGuests(s.guests);
        if (s.layout) setLayout(prev => prev ? { ...prev, tables: s.layout.tables } : prev);
      }
    } catch { /* ignore */ }
    router.refresh();
  }, [router, event.id]);

  const stats = useMemo(() => ({
    tables: layout?.tables.length ?? 0,
    guests: guests.length,
    assigned: guests.filter(g => g.assignedTableId).length,
    qrs: qrCodes.length,
  }), [layout, guests, qrCodes]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-0 border-b border-[var(--color-border)] mb-8">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`px-1 mr-7 h-11 font-medium text-[14px] transition-colors border-b-2 -mb-[1px] ${
              tab === t.key ? "tab-active" : "tab-inactive"
            }`}
          >
            {t.label}
            {t.key === "layout" && stats.tables > 0 && <span className="ml-2 text-[12px] text-[var(--color-fg-faint)] tabular-nums">{stats.tables}</span>}
            {t.key === "guests" && stats.guests > 0 && <span className="ml-2 text-[12px] text-[var(--color-fg-faint)] tabular-nums">{stats.guests}</span>}
            {t.key === "assign" && stats.guests > 0 && <span className="ml-2 text-[12px] text-[var(--color-fg-faint)] tabular-nums">{stats.assigned}/{stats.guests}</span>}
            {t.key === "qr" && stats.qrs > 0 && <span className="ml-2 text-[12px] text-[var(--color-fg-faint)] tabular-nums">{stats.qrs}</span>}
          </button>
        ))}
      </div>

      {tab === "layout" && (
        <LayoutTab
          eventId={event.id}
          layout={layout}
          templates={props.templates}
          onChange={(next) => { setLayout(next); reloadFromServer(); }}
        />
      )}
      {tab === "guests" && (
        <GuestsTab
          eventId={event.id}
          guests={guests}
          onChange={setGuests}
        />
      )}
      {tab === "assign" && (
        <AssignTab
          eventId={event.id}
          layout={layout}
          guests={guests}
          onChange={setGuests}
        />
      )}
      {tab === "qr" && (
        <QRTab
          eventId={event.id}
          publicSlug={event.publicSlug}
          layout={layout}
          qrCodes={qrCodes}
          onChange={setQrCodes}
        />
      )}
      {tab === "settings" && (
        <SettingsTab
          event={event}
          onChange={setEvent}
        />
      )}
    </div>
  );
}
