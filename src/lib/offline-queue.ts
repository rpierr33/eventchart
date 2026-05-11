"use client";

// Offline write queue for host actions in the live view.
// Spec line 172: "The host live view caches the current event state and
// queues any changes (move, mark no-show, approve walk-in) to sync when
// back online."
//
// Pattern: every host write goes through queuedFetch(). If the network is
// up, fetch fires immediately. If the request fails or we're offline, the
// request is appended to IndexedDB and replayed on the next 'online' event
// or window focus.

type QueuedRequest = {
  id: string;
  url: string;
  method: string;
  body: string | null;
  contentType: string | null;
  createdAt: number;
  attempts: number;
  description: string;
};

const DB_NAME = "evcd-offline";
const STORE = "host-actions";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function enqueue(req: QueuedRequest) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(req);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function drainQueue(notify?: (msg: string) => void): Promise<{ replayed: number; failed: number }> {
  const db = await openDb();
  const items: QueuedRequest[] = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
  if (items.length === 0) { db.close(); return { replayed: 0, failed: 0 }; }

  let replayed = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.contentType ? { "content-type": item.contentType } : {},
        body: item.body,
      });
      if (!res.ok && (res.status < 500 || res.status >= 600)) {
        // 4xx — abandon (server permanently rejected). Don't loop forever.
        await deleteItem(db, item.id);
        failed++;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await deleteItem(db, item.id);
      replayed++;
    } catch {
      // network still broken — leave it in the queue for next attempt
      failed++;
    }
  }
  db.close();
  if (replayed > 0) notify?.(`Synced ${replayed} offline action${replayed !== 1 ? "s" : ""}.`);
  return { replayed, failed };
}

function deleteItem(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pendingCount(): Promise<number> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    const db = await openDb();
    const count = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return count;
  } catch {
    return 0;
  }
}

export async function queuedFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit | null; description?: string } = {},
): Promise<{ ok: boolean; queued: boolean; status?: number; data?: unknown }> {
  const method = init.method ?? "POST";
  const contentType = init.headers?.["content-type"] ?? (typeof init.body === "string" ? "application/json" : null);
  const bodyStr = typeof init.body === "string" ? init.body : init.body ? JSON.stringify(init.body) : null;
  const description = init.description ?? `${method} ${url}`;

  const tryNow = async () => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (contentType && !headers["content-type"]) headers["content-type"] = contentType;
    const res = await fetch(url, { method, headers, body: bodyStr });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const data = await res.json().catch(() => ({}));
    return { ok: true, queued: false, status: res.status, data };
  };

  if (typeof navigator !== "undefined" && navigator.onLine) {
    try { return await tryNow(); }
    catch (e) {
      const status = (e as { status?: number })?.status;
      if (status && status >= 400 && status < 500) {
        // Client-side error — don't queue, surface error
        throw e;
      }
      // Server or network error — fall through to enqueue
    }
  }

  await enqueue({
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    url,
    method,
    body: bodyStr,
    contentType,
    createdAt: Date.now(),
    attempts: 0,
    description,
  });
  return { ok: true, queued: true };
}

let installed = false;
export function installQueueDrain(notify?: (msg: string) => void) {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  const run = () => { void drainQueue(notify); };
  window.addEventListener("online", run);
  window.addEventListener("focus", run);
  // Initial drain after a tick (in case anything stale)
  setTimeout(run, 800);
}
