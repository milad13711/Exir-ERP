"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getManager, subscribeGlobal, type OfflineSnapshot } from "./client";
import type { OutboxItem } from "./types";

const EMPTY: OfflineSnapshot = {
  active: false,
  online: true,
  syncing: false,
  authRequired: false,
  counts: { pending: 0, syncing: 0, failed: 0, conflict: 0, done: 0 },
  lastSummary: null,
  lastSyncAt: null,
  lastLookupAt: null,
  clockSkewMs: null,
  servedFromCache: false,
  policy: null,
  persisted: null,
  swSyncSupported: false,
};

/** وضعیت زنده‌ی آفلاین. بدون ماژول/مدیر: active=false و online از navigator. */
export function useOfflineSnapshot(): OfflineSnapshot {
  const [, bump] = useState(0);
  useEffect(() => subscribeGlobal(() => bump((n) => n + 1)), []);
  const m = getManager();
  const sub = useCallback((l: () => void) => (m ? m.subscribe(l) : () => undefined), [m]);
  const get = useCallback(() => (m ? m.getSnapshot() : EMPTY), [m]);
  return useSyncExternalStore(sub, get, () => EMPTY);
}

/** فهرست موارد صف (با هر تغییر شمارنده‌ها دوباره خوانده می‌شود). */
export function useOutboxItems(): { items: OutboxItem[] | null; reload: () => void } {
  const snap = useOfflineSnapshot();
  const [items, setItems] = useState<OutboxItem[] | null>(null);
  const [tick, setTick] = useState(0);
  const key = `${snap.counts.pending}-${snap.counts.syncing}-${snap.counts.failed}-${snap.counts.conflict}-${snap.counts.done}-${tick}`;
  useEffect(() => {
    let alive = true;
    const m = getManager();
    if (!m) return;
    m.store.outboxList().then((r) => alive && setItems(r)).catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [key]);
  return { items: getManager() ? items : [], reload: () => setTick((n) => n + 1) };
}
