import { API_URL, ApiError, getToken } from "../api";
import { SyncEngine, type EngineEvent } from "./engine";
import { IdbDb } from "./idb";
import { identityFromToken } from "./identity";
import { mergeDelta, type DeltaResponse } from "./lookups";
import { applyOverlay } from "./overlay";
import { matchOp, matchReadRule, normalizeSearch, READ_RULES, responseCacheKey, searchContactsLocal, searchProductsLocal, type CachedContact, type CachedProduct, type OfflineOp } from "./registry";
import { OfflineStore, scopeOf, type StorageUsage } from "./store";
import type { Identity, OutboxItem, RunSummary } from "./types";

/**
 * چسب بین موتور خالص و برنامه: singleton مدیر آفلاین، دریافت دلتای فهرست‌ها، خواندن از کش هنگام قطع، رویدادها.
 * این فایل فقط وقتی ماژول offline-sync نصب باشد import/فعال می‌شود (apiFetch با import پویا).
 */

export type OfflinePolicy = {
  enabledOperations: string[];
  maxOfflineDays: number;
  allowedRoles: string[];
  wipeOnLogout: boolean;
  allowReviewedBeyondMax: boolean;
  maxAttachmentMb: number;
  maxQueueMb: number;
};

export type OfflineSnapshot = {
  active: boolean;
  online: boolean;
  syncing: boolean;
  authRequired: boolean;
  counts: { pending: number; syncing: number; failed: number; conflict: number; done: number };
  lastSummary: RunSummary | null;
  lastSyncAt: number | null;
  lastLookupAt: number | null;
  clockSkewMs: number | null;
  servedFromCache: boolean;
  policy: OfflinePolicy | null;
  persisted: boolean | null;
  swSyncSupported: boolean;
};

const FLAG_KEY = "exir_offline_enabled";
const DEFAULT_POLICY: OfflinePolicy = { enabledOperations: [], maxOfflineDays: 7, allowedRoles: [], wipeOnLogout: true, allowReviewedBeyondMax: false, maxAttachmentMb: 25, maxQueueMb: 150 };
const LOOKUPS: Array<{ entity: "contacts" | "products" | "tasksMine" | "users"; cap: number }> = [
  { entity: "contacts", cap: 3000 },
  { entity: "products", cap: 3000 },
  { entity: "users", cap: 1000 },
];

type Listener = () => void;

export class Manager {
  readonly store: OfflineStore;
  readonly engine: SyncEngine;
  private listeners = new Set<Listener>();
  private snap: OfflineSnapshot;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bases = new Map<string, string>();
  private basesDirty = false;
  private lookupRunning = false;
  private stopped = false;
  private policyCache: OfflinePolicy | null = null;
  private enabledSet: Set<string> | undefined;

  constructor(readonly identity: Identity) {
    this.store = new OfflineStore(new IdbDb(indexedDB), identity);
    this.engine = new SyncEngine({
      store: this.store,
      apiUrl: API_URL,
      getToken: () => {
        const cur = identityFromToken(getToken());
        return cur && scopeOf(cur) === scopeOf(identity) ? getToken() : null;
      },
      fetchImpl: (...a) => fetch(...a),
      isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      device: deviceLabel(),
      maxOfflineDays: () => this.policyCache?.maxOfflineDays ?? 7,
      maxFileBytes: () => (this.policyCache?.maxAttachmentMb ?? 25) * 1024 * 1024,
      maxQueueBytes: () => (this.policyCache?.maxQueueMb ?? 150) * 1024 * 1024,
      probe: probeHealth,
      onEvent: (e) => this.onEngineEvent(e),
    });
    this.snap = {
      active: true,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
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
      swSyncSupported: typeof ServiceWorkerRegistration !== "undefined" && "sync" in ServiceWorkerRegistration.prototype,
    };
  }

  // ── وضعیت ──
  getSnapshot = (): OfflineSnapshot => this.snap;
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(patch: Partial<OfflineSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }
  async refreshCounts() {
    const counts = await this.store.outboxCounts();
    this.set({ counts });
  }

  private onEngineEvent(e: EngineEvent) {
    if (e.type === "change") void this.refreshCounts();
    if (e.type === "auth-required") this.set({ authRequired: true });
    if (e.type === "offline") this.set({ online: false });
    if (e.type === "summary") {
      this.set({ lastSummary: e.summary, lastSyncAt: Date.now(), authRequired: e.summary.paused === "auth" });
      if (e.summary.synced > 0 || e.summary.failed > 0 || e.summary.conflicts > 0) {
        window.dispatchEvent(new CustomEvent("exir:offline-summary", { detail: e.summary }));
      }
    }
  }

  // ── چرخه‌ی حیات ──
  async start() {
    await this.loadBases();
    await this.refreshPolicy().catch(() => undefined);
    void requestPersistence().then((p) => this.set({ persisted: p }));
    void this.refreshCounts();
    window.addEventListener("online", this.onOnline);
    window.addEventListener("offline", this.onOffline);
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("focus", this.onOnline);
    navigator.serviceWorker?.addEventListener?.("message", this.onSwMessage);
    this.timer = setInterval(() => void this.tick(), 60_000);
    void this.tick();
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("focus", this.onOnline);
    navigator.serviceWorker?.removeEventListener?.("message", this.onSwMessage);
    if (this.timer) clearInterval(this.timer);
    this.set({ active: false });
  }

  private onOnline = () => {
    this.set({ online: true });
    void this.tick();
  };
  private onOffline = () => this.set({ online: false });
  private onVisible = () => {
    if (document.visibilityState === "visible") void this.tick();
  };
  private onSwMessage = (ev: MessageEvent) => {
    if (ev.data && ev.data.type === "exir-sync-request") void this.syncNow();
  };

  private async tick() {
    if (this.stopped || !navigator.onLine) return;
    await this.syncNow();
    if (!this.snap.lastLookupAt || Date.now() - this.snap.lastLookupAt > 15 * 60_000) void this.refreshLookups();
    void this.store.cacheEvict().catch(() => undefined);
  }

  async syncNow(): Promise<RunSummary> {
    this.set({ syncing: true });
    try {
      const s = await this.engine.run();
      this.set({ online: s.paused !== "offline" });
      return s;
    } finally {
      this.set({ syncing: false });
      await this.refreshCounts();
    }
  }

  // ── سیاست ──
  async refreshPolicy() {
    const res = await authedJson<{ serverTime: string; allowed: boolean; policy: OfflinePolicy }>("/sync/bootstrap");
    this.policyCache = res.policy;
    this.enabledSet = new Set(res.policy.enabledOperations);
    const skew = Date.parse(res.serverTime) - Date.now();
    this.set({ policy: res.policy, clockSkewMs: Number.isFinite(skew) ? skew : null });
    if (!res.allowed) {
      // سیاست از راه دور: این نقش اجازه‌ی کار آفلاین ندارد → کش پاک، صف جدید پذیرفته نمی‌شود
      this.enabledSet = new Set();
      await this.store.wipeCache();
    }
    return res;
  }

  get policy(): OfflinePolicy {
    return this.policyCache ?? DEFAULT_POLICY;
  }

  // ── صف‌کردن از apiFetch ──
  matches(method: string, path: string, body: unknown): { op: OfflineOp; m: RegExpExecArray } | null {
    // قبل از دریافت سیاست: همه‌ی کلیدهای رجیستری مجاز فرض می‌شود تا ثبت آفلاین هنگام شروع سرد کار کند
    const hit = matchOp(method, path, body, this.enabledSet);
    return hit ? { op: hit.op, m: hit.m } : null;
  }

  async enqueue(method: string, path: string, rawBody: string | undefined, hit: { op: OfflineOp; m: RegExpExecArray }, idempotencyKey?: string) {
    let body: unknown = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    const entity = hit.op.entity ? hit.op.entity(hit.m, body) : null;
    const baseUpdatedAt = hit.op.conflict === "stale" && entity ? (this.bases.get(entity) ?? null) : null;
    const label = hit.op.describe ? hit.op.describe(body) : hit.op.label;
    const { id, tempId } = await this.engine.enqueue({ op: hit.op, method, path, body, entity, label, baseUpdatedAt, idempotencyKey });
    void this.registerBackgroundSync();
    window.dispatchEvent(new CustomEvent("exir:offline-queued", { detail: { label, note: hit.op.optimisticNote ?? null } }));
    const base = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    return { ...base, id: tempId ?? hit.m[1] ?? id, tempId: tempId ?? null, queued: true, _queued: true, _queueId: id, _offlineNote: hit.op.optimisticNote ?? null };
  }

  private async registerBackgroundSync() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      const sync = (reg as unknown as { sync?: { register(tag: string): Promise<void> } } | undefined)?.sync;
      if (sync) await sync.register("exir-outbox-sync");
    } catch {
      /* پشتیبانی نمی‌شود (iOS/Safari/Firefox) — همگام‌سازی هنگام online/foreground */
    }
  }

  // ── پایه‌ی نسخه برای تشخیص تعارض ──
  rememberBases(path: string, data: unknown) {
    const p = path.split("?")[0].replace(/^\/api(?=\/)/, "");
    const put = (k: string, v: unknown) => {
      if (typeof v === "string") {
        this.bases.set(k, v);
        this.basesDirty = true;
      }
    };
    const one = (prefix: string, r: unknown) => {
      if (r && typeof r === "object") {
        const o = r as { id?: unknown; updatedAt?: unknown };
        if (typeof o.id === "string") put(`${prefix}:${o.id}`, o.updatedAt);
      }
    };
    let m: RegExpExecArray | null;
    if ((m = /^\/crm\/contacts\/([^/]+)$/.exec(p)) && m[1] !== "search") one("contact", data);
    else if (/^\/tasks\/[^/]+$/.test(p)) one("task", data);
    else if (p === "/tasks" && Array.isArray(data)) data.forEach((r) => one("task", r));
    else if (p === "/daily-checklist" && Array.isArray(data)) data.forEach((r) => one("checklist", r));
    if (this.basesDirty) void this.persistBases();
  }
  private async persistBases() {
    this.basesDirty = false;
    const entries = [...this.bases.entries()].slice(-3000);
    await this.store.cachePut("bases", entries, { entity: "bases", ttlMs: 365 * 86_400_000 }).catch(() => undefined);
  }
  private async loadBases() {
    const hit = await this.store.cacheGet<Array<[string, string]>>("bases", true).catch(() => null);
    if (hit) this.bases = new Map(hit.value);
  }

  // ── خواندن (کش پاسخ / جستجوی محلی) ──
  async observe(path: string, data: unknown) {
    this.rememberBases(path, data);
    const hit = matchReadRule(path);
    if (!hit || hit.rule.mode !== "response") return;
    await this.store.cachePut(responseCacheKey(hit.path, hit.query), data, { entity: hit.rule.entity, ttlMs: hit.rule.ttlMs });
  }

  /** پاسخ آفلاین برای GET؛ undefined = قابل‌پاسخ نیست (خطای شبکه عادی پرتاب شود). */
  async readOffline(path: string): Promise<{ data: unknown } | undefined> {
    const hit = matchReadRule(path);
    if (!hit) return undefined;
    let data: unknown;
    if (hit.rule.mode === "response") {
      const c = await this.store.cacheGet<unknown>(responseCacheKey(hit.path, hit.query), true);
      if (!c) return undefined;
      data = c.value;
      const items = await this.store.outboxList();
      data = applyOverlay(hit.rule.key, data, items, hit.query);
    } else {
      const c = await this.store.cacheGet<unknown[]>(`lookup:${hit.rule.entity}`, true);
      if (!c) return undefined;
      data = hit.rule.mode === "local-contacts" ? searchContactsLocal(c.value as CachedContact[], hit.query) : searchProductsLocal(c.value as CachedProduct[], hit.query);
      if (hit.rule.mode === "local-contacts") {
        const q = normalizeSearch(hit.query.get("q") ?? "");
        const pend = (await this.store.outboxList()).filter((i) => i.opKey === "crm.contact.create" && i.status !== "done");
        for (const it of pend) {
          const b = (it.body ?? {}) as { name?: string; company?: string; phone?: string };
          if (!q || normalizeSearch(`${b.name ?? ""} ${b.company ?? ""} ${b.phone ?? ""}`).includes(q)) {
            (data as unknown[]).unshift({ id: it.tempId, type: "INDIVIDUAL", name: `${b.name ?? ""} (در صف همگام‌سازی)`, company: b.company ?? null, phone: b.phone ?? null, nationalId: null, isCustomer: true, isSupplier: false, _queued: true });
          }
        }
      }
    }
    this.set({ servedFromCache: true });
    window.dispatchEvent(new CustomEvent("exir:offline-served-from-cache"));
    return { data };
  }

  // ── دلتای فهرست‌ها ──
  async refreshLookups(full = false) {
    if (this.lookupRunning || !navigator.onLine) return;
    this.lookupRunning = true;
    try {
      for (const { entity, cap } of LOOKUPS) {
        const cacheKey = `lookup:${entity}`;
        const prev = full ? null : await this.store.cacheGet<Array<{ id: string; updatedAt?: string }>>(cacheKey, true);
        const sinceKey = `since:${entity}`;
        const lastFullKey = `lastFull:${entity}`;
        const lastFull = (await this.store.metaGet<number>(lastFullKey)) ?? 0;
        const wantIds = Date.now() - lastFull > 24 * 3600_000; // هر روز یک‌بار حذف‌شده‌ها هم هرس شوند
        let since = prev && !wantIds ? ((await this.store.metaGet<string>(sinceKey)) ?? null) : null;
        let rows = prev?.value ?? [];
        for (let guard = 0; guard < 20; guard += 1) {
          const qs = new URLSearchParams({ entities: entity, limit: "1000" });
          if (since) qs.set("since", since);
          if (wantIds && !since) qs.set("withIds", "1");
          const res = await authedJson<{ entities: Record<string, DeltaResponse<{ id: string; updatedAt?: string }> & { unavailable?: string }> }>(`/sync/changes?${qs}`);
          const part = res.entities[entity];
          if (!part || part.unavailable) break;
          rows = mergeDelta(rows, part, cap);
          since = part.nextSince ?? since;
          if (!part.truncated) break;
        }
        await this.store.cachePut(cacheKey, rows, { entity, ttlMs: 6 * 3600_000 });
        if (since) await this.store.metaSet(sinceKey, since);
        if (wantIds) await this.store.metaSet(lastFullKey, Date.now());
      }
      this.set({ lastLookupAt: Date.now() });
    } catch {
      /* بهترین تلاش؛ دفعه‌ی بعد */
    } finally {
      this.lookupRunning = false;
    }
  }

  // ── پاک‌سازی ──
  async wipeOfflineData(opts: { discardQueue: boolean }) {
    await this.store.wipe({ keepOutbox: !opts.discardQueue });
    this.bases.clear();
    await this.refreshCounts();
  }

  async usage(): Promise<{ usage: StorageUsage; estimate: { usage: number; quota: number } | null }> {
    return { usage: await this.store.usage(), estimate: await storageEstimate() };
  }
}

// ── ابزار ──
function deviceLabel(): string {
  try {
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Device";
    const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
    return `${os} ${br}`;
  } catch {
    return "Device";
  }
}

async function probeHealth(): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${API_URL}/health`, { cache: "no-store", signal: ctl.signal });
    clearTimeout(t);
    return res.status < 600; // هر پاسخ HTTP یعنی سرور در دسترس است
  } catch {
    return false;
  }
}

async function authedJson<T>(path: string): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError("خطا در همگام‌سازی", res.status);
  return res.json() as Promise<T>;
}

export async function requestPersistence(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && typeof e.quota === "number" ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}

// ── singleton ──
let manager: Manager | null = null;

export function getManager(): Manager | null {
  return manager;
}

/** ماژول نصب‌شده → مدیر را بساز/روشن کن؛ نصب‌نبودن → خاموش. */
export async function activateOffline(installed: boolean): Promise<void> {
  if (typeof window === "undefined") return;
  const id = identityFromToken(getToken());
  if (!installed || !id) {
    if (!installed) {
      try {
        window.localStorage.removeItem(FLAG_KEY);
      } catch {
        /* */
      }
    }
    manager?.stop();
    manager = null;
    notifyGlobal();
    return;
  }
  try {
    window.localStorage.setItem(FLAG_KEY, id.tenantId);
  } catch {
    /* */
  }
  if (manager && scopeOf(manager.identity) === scopeOf(id)) return;
  manager?.stop();
  if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) return; // مرورگر قدیمی/غیرامن: بدون آفلاین
  manager = new Manager(id);
  await manager.start();
  void migrateLegacyQueue(manager);
  notifyGlobal();
}

/** شروع سرد آفلاین: پرچم محلی می‌گوید ماژول قبلاً فعال بوده، بدون نیاز به شبکه. */
export async function bootOfflineFromStorage(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const id = identityFromToken(getToken());
  let flag: string | null = null;
  try {
    flag = window.localStorage.getItem(FLAG_KEY);
  } catch {
    /* */
  }
  if (!id || flag !== id.tenantId) return false;
  await activateOffline(true);
  return manager !== null;
}

const globalListeners = new Set<Listener>();
function notifyGlobal() {
  globalListeners.forEach((l) => l());
}
export function subscribeGlobal(l: Listener): () => void {
  globalListeners.add(l);
  return () => globalListeners.delete(l);
}

/** صف قدیمی (نسخه‌ی ۱ ماژول) را یک‌بار به صف جدید منتقل می‌کند. */
async function migrateLegacyQueue(m: Manager) {
  try {
    const { listPending, removePending } = await import("./legacy-db");
    const old = await listPending();
    for (const q of old) {
      const hit = m.matches(q.method, q.url, q.body ? JSON.parse(q.body) : null);
      if (!hit) continue;
      await m.enqueue(q.method, q.url, q.body ?? undefined, hit);
      await removePending(q.id);
    }
  } catch {
    /* پایگاه قدیمی نبود */
  }
}

// ── API برای apiFetch ──
export type QueueOutcome = { queued: object } | { unavailable: true };

export async function onSessionInvalid() {
  await manager?.store.wipeCache().catch(() => undefined);
}

export async function saveWorkspaceSnapshot(snap: unknown) {
  await manager?.store.cachePut("workspace", snap, { entity: "workspace", ttlMs: 90 * 86_400_000 }).catch(() => undefined);
}
export async function loadWorkspaceSnapshot<T>(): Promise<T | null> {
  if (!manager) await bootOfflineFromStorage();
  const c = await manager?.store.cacheGet<T>("workspace", true).catch(() => null);
  return c?.value ?? null;
}

export { READ_RULES };
export type { OutboxItem };
