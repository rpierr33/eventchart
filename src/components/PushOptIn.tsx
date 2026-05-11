"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = typeof window !== "undefined" ? window.atob(base64) : "";
  const buf = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buf;
}

export default function PushOptIn() {
  const [state, setState] = useState<"idle" | "denied" | "granted" | "unsupported">("idle");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    setState(Notification.permission === "granted" ? "granted" : Notification.permission === "denied" ? "denied" : "idle");
  }, []);

  async function subscribe() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "idle");
        toast.error(perm === "denied" ? "Notifications blocked. Allow them in browser settings to get walk-in alerts." : "Permission not granted.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublic) {
        toast.error("Push key not configured on this build.");
        return;
      }
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapidPublic),
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent.slice(0, 200),
        }),
      });
      if (!res.ok) throw new Error("Server reject");
      setState("granted");
      toast.success("Walk-in alerts on. Your phone will buzz when one needs approval.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }

  if (state === "unsupported") return null;
  if (state === "granted") {
    return (
      <span className="badge badge-green">🔔 Walk-in alerts on</span>
    );
  }
  if (state === "denied") {
    return (
      <span className="badge badge-yellow" title="Allow in browser site settings to enable">🔕 Alerts blocked</span>
    );
  }
  return (
    <button onClick={subscribe} disabled={busy} className="btn h-9 text-[13px]">
      {busy ? "Enabling…" : "🔔 Enable walk-in alerts"}
    </button>
  );
}
