"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";

type EventInfo = {
  name: string;
  venueName: string | null;
  status: "DRAFT" | "LIVE" | "ENDED";
  lookupPrivacy: "PUBLIC" | "CODE_PROTECTED";
  allowWalkIns: boolean;
  walkInMode: "AUTO_SEAT" | "REQUIRE_HOST_APPROVAL";
};

type QRInfo = {
  id: string;
  label: string;
  scanOriginXPct: number | null;
  scanOriginYPct: number | null;
} | null;

type LayoutInfo = {
  sourceImageUrl: string;
  sourceImageWidth: number;
  sourceImageHeight: number;
  tables: { id: string; label: string; capacity: number; xPct: number; yPct: number; directionsText: string | null }[];
} | null;

type GuestMatch = {
  id: string;
  firstName: string;
  lastName: string;
  tableId: string | null;
  tableLabel: string | null;
  tableXPct: number | null;
  tableYPct: number | null;
  tableDirections: string | null;
};

type LookupResult =
  | { kind: "matches"; matches: GuestMatch[] }
  | { kind: "single"; match: GuestMatch }
  | { kind: "none" };

const SESSION_KEY = (slug: string) => `evcd_${slug}_unlocked`;

export default function GuestLookupClient(props: {
  slug: string;
  event: EventInfo;
  qr: QRInfo;
  layout: LayoutInfo;
}) {
  const { slug, event, qr, layout } = props;

  const [stage, setStage] = useState<"gate" | "lookup" | "result" | "plusone" | "walkin">("lookup");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [chosen, setChosen] = useState<GuestMatch | null>(null);

  useEffect(() => {
    if (event.lookupPrivacy === "CODE_PROTECTED") {
      const unlocked = typeof window !== "undefined" && window.sessionStorage.getItem(SESSION_KEY(slug));
      setStage(unlocked === "1" ? "lookup" : "gate");
    }
  }, [event.lookupPrivacy, slug]);

  const lookup = useCallback(async (ln: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/public/${slug}/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastName: ln.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Lookup failed");
      setResult(data as LookupResult);
      if (data.kind === "single") {
        setChosen(data.match);
        await fetch(`/api/public/${slug}/checkin`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ guestId: data.match.id }),
        }).catch(() => {});
      }
      setStage("result");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(false);
    }
  }, [slug]);

  async function onSubmitLastName(e: React.FormEvent) {
    e.preventDefault();
    if (!lastName.trim()) return;
    await lookup(lastName);
  }

  async function chooseMatch(m: GuestMatch) {
    setChosen(m);
    await fetch(`/api/public/${slug}/checkin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestId: m.id }),
    }).catch(() => {});
  }

  function reset() {
    setStage("lookup");
    setResult(null);
    setChosen(null);
    setLastName("");
  }

  return (
    <main className="min-h-screen flex flex-col">
      <header className="px-6 pt-6 pb-4 text-center">
        <h1 className="display text-[28px] leading-none tracking-tight">{event.name}</h1>
        <div className="text-[12px] text-[var(--color-fg-muted)] mt-2 tracking-wide uppercase">
          {event.venueName ?? "Welcome"}{qr ? ` · ${qr.label}` : ""}
        </div>
      </header>

      <div className="flex-1 flex flex-col px-5">
        {stage === "gate" && (
          <CodeGate slug={slug} onUnlocked={() => setStage("lookup")} />
        )}

        {stage === "lookup" && (
          <form onSubmit={onSubmitLastName} className="flex-1 flex flex-col justify-center max-w-sm w-full mx-auto py-8">
            <p className="display text-[24px] text-center mb-1 leading-tight">Find your seat</p>
            <label htmlFor="lastName" className="text-[13px] text-[var(--color-fg-muted)] text-center mb-5">Type your last name</label>
            <input
              id="lastName"
              autoFocus
              autoComplete="family-name"
              className="input h-16 px-5 text-center"
              style={{ fontSize: "24px", letterSpacing: "-0.01em" }}
              value={lastName}
              onChange={e => setLastName(e.target.value)}
              placeholder="Pierre"
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary h-14 text-[16px] mt-4" disabled={busy || !lastName.trim()}>
              {busy ? "Looking up…" : "Find my seat"}
            </button>
            {event.allowWalkIns && (
              <button type="button" onClick={() => setStage("walkin")} className="btn btn-ghost h-12 mt-3 text-[14px]">
                I&apos;m a walk-in
              </button>
            )}
          </form>
        )}

        {stage === "result" && result && (
          <ResultView
            result={result}
            chosen={chosen}
            onChoose={chooseMatch}
            onReset={reset}
            onPlusOne={() => setStage("plusone")}
            onWalkIn={() => setStage("walkin")}
            event={event}
            qr={qr}
            layout={layout}
            slug={slug}
          />
        )}

        {stage === "plusone" && (
          <PlusOneFlow
            slug={slug}
            onCancel={reset}
            onFound={(g) => { setChosen(g); setResult({ kind: "single", match: g }); setStage("result"); }}
          />
        )}

        {stage === "walkin" && (
          <WalkInFlow
            slug={slug}
            qrId={qr?.id ?? null}
            event={event}
            onCancel={reset}
            onSeated={(g) => { setChosen(g); setResult({ kind: "single", match: g }); setStage("result"); }}
          />
        )}
      </div>
    </main>
  );
}

function CodeGate({ slug, onUnlocked }: { slug: string; onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(code)) { toast.error("Enter 4 digits"); return; }
    setBusy(true);
    const res = await fetch(`/api/public/${slug}/verify-code`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      toast.error("Wrong code");
      return;
    }
    window.sessionStorage.setItem(SESSION_KEY(slug), "1");
    onUnlocked();
  }

  return (
    <form onSubmit={submit} className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto py-6">
      <p className="text-sm text-[var(--color-fg-muted)] mb-2">This event is code-protected.</p>
      <label className="text-sm text-[var(--color-fg-muted)] mb-2">Enter the 4-digit code from your invitation</label>
      <input
        inputMode="numeric"
        pattern="\d{4}"
        maxLength={4}
        className="input text-3xl h-16 px-5 text-center tracking-[0.5em]"
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
        autoFocus
      />
      <button type="submit" className="btn btn-primary h-14 text-lg mt-4" disabled={busy || code.length !== 4}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

function ResultView({
  result, chosen, onChoose, onReset, onPlusOne, onWalkIn, event, qr, layout, slug,
}: {
  result: LookupResult;
  chosen: GuestMatch | null;
  onChoose: (m: GuestMatch) => void;
  onReset: () => void;
  onPlusOne: () => void;
  onWalkIn: () => void;
  event: EventInfo;
  qr: QRInfo;
  layout: LayoutInfo;
  slug: string;
}) {
  if (result.kind === "single" || chosen) {
    const match = (chosen ?? (result.kind === "single" ? result.match : null))!;
    return (
      <div className="flex-1 flex flex-col max-w-md w-full mx-auto py-4 gap-4">
        <div className="card p-6 text-center">
          <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-[0.08em]">Welcome,</p>
          <h2 className="display text-[32px] mt-1 leading-tight">{match.firstName} {match.lastName}</h2>
          {match.tableLabel ? (
            <>
              <div className="hairline my-5" />
              <p className="text-[12px] text-[var(--color-fg-muted)] uppercase tracking-[0.08em]">Your table</p>
              <p className="display text-[64px] leading-none mt-1 text-[var(--color-fg)]">{match.tableLabel}</p>
              {match.tableDirections && (
                <p className="text-[15px] mt-4 text-[var(--color-fg-muted)] italic font-serif">{match.tableDirections}</p>
              )}
            </>
          ) : (
            <p className="text-[14px] text-[var(--color-fg-muted)] mt-4">Your seat hasn&apos;t been assigned yet — please ask the host.</p>
          )}
        </div>

        {layout && match.tableXPct !== null && match.tableYPct !== null && (
          <DirectionsMap
            layout={layout}
            targetXPct={match.tableXPct}
            targetYPct={match.tableYPct}
            originXPct={qr?.scanOriginXPct ?? null}
            originYPct={qr?.scanOriginYPct ?? null}
            originLabel={qr?.label ?? null}
            tableLabel={match.tableLabel ?? ""}
          />
        )}

        <button onClick={onReset} className="btn h-12 text-[14px]">Search again</button>
      </div>
    );
  }

  if (result.kind === "matches") {
    return (
      <div className="flex-1 flex flex-col max-w-md w-full mx-auto py-6 gap-4">
        <h2 className="text-xl font-semibold text-center">Multiple matches</h2>
        <p className="text-center text-sm text-[var(--color-fg-muted)]">Which one are you?</p>
        <div className="flex flex-col gap-2">
          {result.matches.map(m => (
            <button key={m.id} onClick={() => onChoose(m)} className="btn h-14 text-base justify-start px-5">
              {m.firstName} {m.lastName}
            </button>
          ))}
        </div>
        <button onClick={onReset} className="btn btn-ghost h-12">Back</button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col max-w-md w-full mx-auto py-6 gap-3 text-center">
      <h2 className="text-xl font-semibold">We didn&apos;t find your name</h2>
      {event.allowWalkIns ? (
        <>
          <p className="text-sm text-[var(--color-fg-muted)] mb-2">
            Are you here as a plus-one? Or arriving as a walk-in?
          </p>
          <button onClick={onPlusOne} className="btn h-14 text-base">I&apos;m a plus-one</button>
          <button onClick={onWalkIn} className="btn btn-primary h-14 text-base">I&apos;m a walk-in</button>
          <button onClick={onReset} className="btn btn-ghost h-12 mt-2">Try a different last name</button>
        </>
      ) : (
        <>
          <p className="text-sm text-[var(--color-fg-muted)]">Please see the host at the entrance.</p>
          <button onClick={onReset} className="btn btn-ghost h-12 mt-4">Try again</button>
        </>
      )}
    </div>
  );
}

function DirectionsMap({
  layout,
  targetXPct,
  targetYPct,
  originXPct,
  originYPct,
  originLabel,
  tableLabel,
}: {
  layout: NonNullable<LayoutInfo>;
  targetXPct: number;
  targetYPct: number;
  originXPct: number | null;
  originYPct: number | null;
  originLabel: string | null;
  tableLabel: string;
}) {
  const aspect = layout.sourceImageHeight / layout.sourceImageWidth;
  return (
    <div className="card overflow-hidden">
      <div className="relative bg-black select-none" style={{ paddingTop: `${aspect * 100}%` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={layout.sourceImageUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
        {layout.tables.map(t => (
          <div key={t.id} className="pin pin-gray opacity-60" style={{ left: `${t.xPct}%`, top: `${t.yPct}%`, pointerEvents: "none", width: 22, height: 22, fontSize: 11 }}>
            {t.label.match(/\d+/)?.[0] ?? "•"}
          </div>
        ))}
        <div className="target-ring" style={{ left: `${targetXPct}%`, top: `${targetYPct}%` }} />
        <div className="pin pin-red" style={{ left: `${targetXPct}%`, top: `${targetYPct}%`, pointerEvents: "none" }}>{tableLabel.match(/\d+/)?.[0] ?? "•"}</div>
        {originXPct !== null && originYPct !== null && (
          <>
            <div className="you-are-here" style={{ left: `${originXPct}%`, top: `${originYPct}%` }} />
          </>
        )}
      </div>
      <div className="p-3 text-xs text-[var(--color-fg-muted)] flex items-center justify-between">
        <span>🔴 your table</span>
        {originLabel && <span>🟢 you are here · {originLabel}</span>}
      </div>
    </div>
  );
}

function PlusOneFlow({ slug, onCancel, onFound }: { slug: string; onCancel: () => void; onFound: (g: GuestMatch) => void }) {
  const [hostName, setHostName] = useState("");
  const [busy, setBusy] = useState(false);
  const [matches, setMatches] = useState<GuestMatch[]>([]);
  const [yourFirst, setYourFirst] = useState("");
  const [yourLast, setYourLast] = useState("");
  const [hostId, setHostId] = useState<string | null>(null);

  async function findHost(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch(`/api/public/${slug}/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastName: hostName.trim() }),
    });
    setBusy(false);
    const data = await res.json();
    if (data.kind === "single") { setMatches([data.match]); setHostId(data.match.id); }
    else if (data.kind === "matches") setMatches(data.matches);
    else { toast.error("No host with that last name."); setMatches([]); }
  }

  async function claim() {
    if (!hostId || !yourFirst.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/public/${slug}/plusone`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hostGuestId: hostId, firstName: yourFirst.trim(), lastName: yourLast.trim() || null }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not claim"); return; }
    onFound(data.guest);
  }

  return (
    <div className="flex-1 flex flex-col max-w-md w-full mx-auto py-6 gap-3">
      <h2 className="text-xl font-semibold text-center">Find your host</h2>
      <p className="text-sm text-[var(--color-fg-muted)] text-center mb-2">Enter the last name of the person who invited you.</p>
      {!hostId && matches.length === 0 && (
        <form onSubmit={findHost} className="flex flex-col gap-3">
          <input className="input text-xl h-14 text-center" autoFocus value={hostName} onChange={e => setHostName(e.target.value)} placeholder="Host's last name" />
          <button type="submit" className="btn btn-primary h-12" disabled={busy || !hostName.trim()}>{busy ? "Searching…" : "Find host"}</button>
          <button type="button" onClick={onCancel} className="btn btn-ghost h-10">Back</button>
        </form>
      )}
      {!hostId && matches.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-center text-sm">Which one is your host?</p>
          {matches.map(m => (
            <button key={m.id} onClick={() => setHostId(m.id)} className="btn h-12 justify-start px-5">
              {m.firstName} {m.lastName}
            </button>
          ))}
          <button onClick={onCancel} className="btn btn-ghost h-10">Back</button>
        </div>
      )}
      {hostId && (
        <div className="flex flex-col gap-3">
          <p className="text-center text-sm">Tell us your name so we can seat you with them.</p>
          <input className="input" autoFocus placeholder="Your first name" value={yourFirst} onChange={e => setYourFirst(e.target.value)} />
          <input className="input" placeholder="Your last name (optional)" value={yourLast} onChange={e => setYourLast(e.target.value)} />
          <button onClick={claim} className="btn btn-primary h-12" disabled={busy || !yourFirst.trim()}>{busy ? "Saving…" : "Find my seat"}</button>
          <button onClick={() => { setHostId(null); setMatches([]); }} className="btn btn-ghost h-10">Back</button>
        </div>
      )}
    </div>
  );
}

function WalkInFlow({
  slug, qrId, event, onCancel, onSeated,
}: {
  slug: string;
  qrId: string | null;
  event: EventInfo;
  onCancel: () => void;
  onSeated: (g: GuestMatch) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() && !lastName.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/public/${slug}/walkin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim(), qrId }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { toast.error(data?.error ?? "Could not submit"); return; }
    if (data.status === "AUTO_SEATED") {
      onSeated(data.guest);
    } else {
      setSubmitted(true);
    }
  }

  if (submitted) {
    return (
      <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto py-6 gap-4 text-center">
        <div className="text-5xl">⏳</div>
        <h2 className="text-xl font-semibold">Sent to the host</h2>
        <p className="text-sm text-[var(--color-fg-muted)]">
          We let the host know you&apos;re here. They&apos;ll come find you with a seat — usually within a minute or two.
        </p>
        <button onClick={onCancel} className="btn h-12">Back</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex-1 flex flex-col max-w-md w-full mx-auto py-6 gap-3">
      <h2 className="text-xl font-semibold text-center">Walk-in</h2>
      <p className="text-sm text-[var(--color-fg-muted)] text-center mb-2">
        {event.walkInMode === "AUTO_SEAT" ? "We&apos;ll find you an open seat right now." : "The host will approve you and assign a seat."}
      </p>
      <input className="input" autoFocus placeholder="First name" value={firstName} onChange={e => setFirstName(e.target.value)} />
      <input className="input" placeholder="Last name" value={lastName} onChange={e => setLastName(e.target.value)} />
      <button type="submit" className="btn btn-primary h-12" disabled={busy || (!firstName.trim() && !lastName.trim())}>
        {busy ? "Submitting…" : event.walkInMode === "AUTO_SEAT" ? "Seat me" : "Notify the host"}
      </button>
      <button type="button" onClick={onCancel} className="btn btn-ghost h-10">Back</button>
    </form>
  );
}
