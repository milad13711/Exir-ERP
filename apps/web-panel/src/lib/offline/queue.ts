import { addPending, listPending, removePending, type QueuedRequest } from "./db";

/** Thrown by apiFetch instead of ApiError when a mutation is queued offline
 * instead of sent — callers that want a friendlier message than a generic
 * failure toast can catch this specifically. */
export class OfflineQueuedError extends Error {
  constructor(public queueId: number) {
    super("اتصال اینترنت برقرار نیست — درخواست ذخیره شد و به‌محض اتصال مجدد ارسال می‌شود");
  }
}

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let flushing = false;

async function notify(): Promise<void> {
  const pending = await listPending();
  listeners.forEach((l) => l(pending.length));
}

export function subscribePendingCount(listener: Listener): () => void {
  listeners.add(listener);
  notify();
  return () => listeners.delete(listener);
}

export async function getPendingCount(): Promise<number> {
  return (await listPending()).length;
}

export async function enqueue(method: string, url: string, body: string | null, description: string): Promise<number> {
  const id = await addPending({ method, url, body, description, createdAt: new Date().toISOString() });
  await notify();
  return id;
}

/**
 * Replays every queued request against the real API, in the order they were
 * queued (so e.g. "create contact" replays before a later "add note to
 * contact" that depends on it). Stops at the first request that still fails
 * for a NETWORK reason (still offline, or connection dropped again — no
 * point trying the rest yet); a request that fails for any other reason
 * (e.g. the server now rejects it) is dropped so one bad entry can't jam
 * the queue forever, and logged to the console for now — there's no error
 * log endpoint for the tenant's own client-side offline queue yet.
 */
export async function flushQueue(getToken: () => string | null, apiUrl: string): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const pending = await listPending();
    for (const item of pending) {
      const ok = await replay(item, getToken, apiUrl);
      if (!ok.sent && ok.reason === "network") break;
      await removePending(item.id);
      if (!ok.sent) {
        console.error(`[offline] dropped queued request after server rejected it: ${item.method} ${item.url}`);
      }
    }
  } finally {
    flushing = false;
    await notify();
  }
}

async function replay(
  item: QueuedRequest,
  getToken: () => string | null,
  apiUrl: string,
): Promise<{ sent: boolean; reason?: "network" }> {
  const token = getToken();
  try {
    const res = await fetch(`${apiUrl}${item.url}`, {
      method: item.method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: item.body ?? undefined,
    });
    return { sent: res.ok };
  } catch {
    return { sent: false, reason: "network" };
  }
}
