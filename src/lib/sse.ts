// Simple in-process pub/sub for SSE.
// Works fine on a single Next.js instance (local dev, single-replica Vercel).
// In a multi-instance deployment, replace with Redis pub/sub or Vercel Queues.

type Listener = (payload: unknown) => void;

const channels = new Map<string, Set<Listener>>();

export function subscribe(eventId: string, listener: Listener): () => void {
  let set = channels.get(eventId);
  if (!set) {
    set = new Set();
    channels.set(eventId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) channels.delete(eventId);
  };
}

export function broadcast(eventId: string, payload: unknown) {
  const set = channels.get(eventId);
  if (!set) return;
  for (const fn of set) {
    try { fn(payload); } catch { /* ignore */ }
  }
}
