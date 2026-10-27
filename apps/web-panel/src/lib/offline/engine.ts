import { matchOp, type OfflineOp } from "./registry";
import type { OfflineStore } from "./store";
import { OUTBOX_SCHEMA_VERSION, type OutboxItem, type RunSummary } from "./types";

/** موتور همگام‌سازی: صف دائمی، FIFO داخل گروه وابستگی، موازی بین گروه‌ها، Idempotency-Key، tmp-id، backoff، مکث آفلاین/۴۰۱. */

export type EngineEvent =
  | { type: "change" }
  | { type: "summary"; summary: RunSummary }
  | { type: "auth-required" }
  | { type: "offline" };

export type EngineDeps = {
  store: OfflineStore;
  apiUrl: string;
  getToken: () => string | null;
  fetchImpl: typeof fetch;
  isOnline: () => boolean;
  now?: () => number;
  random?: () => number;
  newId?: () => string;
  device?: string;
  concurrency?: number;
  maxAttempts?: number;
  maxOfflineDays?: () => number;
  maxFileBytes?: () => number;
  maxQueueBytes?: () => number;
  probe?: () => Promise<boolean>;
  onEvent?: (e: EngineEvent) => void;
  requestTimeoutMs?: number;
};

export class OfflineLimitError extends Error {}
class PauseSignal extends Error {
  constructor(readonly reason: "offline" | "auth") {
    super(reason);
  }
}

const TMP_RE = /tmp_[0-9a-zA-Z-]{8,64}/g;
const INLINE_MIN = 8192;
const DONE_KEEP_MS = 24 * 3600 * 1000;

export function findTmpIds(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith("data:") || value.length > 100_000) return out;
    for (const m of value.matchAll(TMP_RE)) out.add(m[0]);
  } else if (Array.isArray(value)) value.forEach((v) => findTmpIds(v, out));
  else if (value && typeof value === "object") for (const v of Object.values(value)) findTmpIds(v, out);
  return out;
}

export function replaceTmp<T>(value: T, map: Record<string, string>): T {
  const keys = Object.keys(map);
  if (keys.length === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.startsWith("data:")) return v;
      let s = v;
      for (const k of keys) if (s.includes(k)) s = s.split(k).join(map[k]);
      return s;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** رشته‌های data-URI بزرگ را بیرون می‌کشد و با {"$blob":id} جایگزین می‌کند. */
export function extractBlobs(body: unknown, newId: () => string): { body: unknown; blobs: Array<{ id: string; type: string; name: string; data: ArrayBuffer }> } {
  const blobs: Array<{ id: string; type: string; name: string; data: ArrayBuffer }> = [];
  const walk = (v: unknown): unknown => {
    if (typeof v === "string" && v.startsWith("data:") && v.length >= INLINE_MIN) {
      const m = /^data:([^;,]*)(;[^,]*)?,([\s\S]*)$/.exec(v);
      if (!m) return v;
      const id = `blob_${newId()}`;
      let bytes: Uint8Array;
      if ((m[2] ?? "").includes("base64")) {
        const bin = atob(m[3]);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      } else bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
      blobs.push({ id, type: m[1] || "application/octet-stream", name: id, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
      return { $blob: id };
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { body: walk(body), blobs };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function backoffMs(attempts: number, random: () => number): number {
  const base = Math.min(2000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
  return Math.round(base * (0.5 + random() * 0.5));
}

export type EnqueueInput = {
  op: OfflineOp;
  method: string;
  path: string;
  body: unknown;
  entity?: string | null;
  label: string;
  baseUpdatedAt?: string | null;
  /** کلید Idempotency درخواست آنلاینی که شبکه‌اش قطع شد (تا اگر پاسخ گم شده باشد، تکراری ساخته نشود) */
  idempotencyKey?: string;
};

type Outcome =
  | { kind: "ok"; body: unknown }
  | { kind: "retry"; message: string; afterMs?: number }
  | { kind: "auth" }
  | { kind: "conflict"; serverUpdatedAt?: string; message: string }
  | { kind: "reject"; status: number; message: string; code?: string };

export class SyncEngine {
  private running: Promise<RunSummary> | null = null;
  private authFailedToken: string | null | undefined;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly newId: () => string;

  constructor(private readonly d: EngineDeps) {
    this.now = d.now ?? (() => Date.now());
    this.random = d.random ?? Math.random;
    this.newId = d.newId ?? (() => globalThis.crypto.randomUUID());
  }

  private emit(e: EngineEvent) {
    try {
      this.d.onEvent?.(e);
    } catch {
      /* listener errors never break the engine */
    }
  }

  // ── صف‌کردن ──────────────────────────────────────────────────────────────
  async enqueue(input: EnqueueInput): Promise<{ id: string; tempId?: string }> {
    const store = this.d.store;
    const id = this.newId();
    const seq = await store.nextSeq();

    // ارجاع به شناسه‌های موقت: اول نگاشت‌های حل‌شده، بعد سازنده‌های هنوز در صف
    let path = input.path;
    let body = input.body;
    const refs = new Set<string>([...findTmpIds(path), ...findTmpIds(body)]);
    const map: Record<string, string> = {};
    const unresolved: string[] = [];
    for (const t of refs) {
      const real = await store.tmpGet(t);
      if (real) map[t] = real;
      else unresolved.push(t);
    }
    path = replaceTmp(path, map);
    body = replaceTmp(body, map);

    const existing = await store.outboxList();
    const dependsOn: string[] = [];
    let group: string | null = null;
    for (const t of unresolved) {
      const creator = existing.find((i) => i.tempId === t && i.status !== "done");
      if (creator) {
        dependsOn.push(creator.id);
        group ??= creator.group;
      }
    }
    group ??= input.entity ? `e:${input.entity}` : `solo:${id}`;
    // ویرایش روی موجودیتی که همین گروه را دارد، در همان گروه می‌ماند (ترتیب حفظ می‌شود)

    const { body: slim, blobs } = extractBlobs(body, this.newId);
    const maxFile = this.d.maxFileBytes?.() ?? 25 * 1024 * 1024;
    const maxQueue = this.d.maxQueueBytes?.() ?? 150 * 1024 * 1024;
    for (const b of blobs) if (b.data.byteLength > maxFile) throw new OfflineLimitError(`حجم فایل از سقف مجاز آفلاین (${Math.round(maxFile / 1048576)}MB) بیشتر است`);
    if (blobs.length) {
      const usage = await store.usage();
      const add = blobs.reduce((n, b) => n + b.data.byteLength, 0);
      if (usage.blobBytes + add > maxQueue) throw new OfflineLimitError("حافظه‌ی صف آفلاین پر است؛ ابتدا همگام‌سازی کنید");
    }

    const tempId = input.op.creates ? `tmp_${this.newId()}` : undefined;
    const item: OutboxItem = {
      id,
      seq,
      idempotencyKey: input.idempotencyKey ?? this.newId().replace(/-/g, "") + this.newId().replace(/-/g, "").slice(0, 8),
      opKey: input.op.key,
      kind: input.op.kind,
      method: input.method.toUpperCase(),
      path,
      body: slim,
      blobIds: blobs.map((b) => b.id),
      group,
      dependsOn,
      tempId,
      baseUpdatedAt: input.op.conflict === "stale" ? (input.baseUpdatedAt ?? null) : null,
      label: input.label,
      createdAtDevice: new Date(this.now()).toISOString(),
      attempts: 0,
      nextTryAt: 0,
      status: "pending",
      schemaVersion: OUTBOX_SCHEMA_VERSION,
    };
    await store.outboxAdd(item, blobs);
    this.emit({ type: "change" });
    return { id, tempId };
  }

  // ── اجرا ─────────────────────────────────────────────────────────────────
  isRunning(): boolean {
    return this.running !== null;
  }

  /** پس از ورود دوباره (توکن جدید) مکث ۴۰۱ برداشته می‌شود. */
  clearAuthPause() {
    this.authFailedToken = undefined;
  }

  run(): Promise<RunSummary> {
    if (this.running) return this.running;
    this.running = this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async summary(synced: number, paused: RunSummary["paused"]): Promise<RunSummary> {
    const c = await this.d.store.outboxCounts();
    return { synced, failed: c.failed, conflicts: c.conflict, remaining: c.pending + c.syncing, paused };
  }

  private async doRun(): Promise<RunSummary> {
    const store = this.d.store;
    if (this.authFailedToken !== undefined && this.d.getToken() === this.authFailedToken) return this.summary(0, "auth");
    if (!this.d.isOnline()) {
      this.emit({ type: "offline" });
      return this.summary(0, "offline");
    }
    if (!this.d.getToken()) return this.summary(0, "auth");

    // بازیابی بعد از کرش: «syncing» باقی‌مانده یعنی پاسخ را ندیدیم؛ با همان Idempotency-Key امن بازپخش می‌شود
    for (const it of await store.outboxList()) {
      if (it.status === "syncing") await store.outboxUpdate({ ...it, status: "pending" });
      else if (it.status === "done" && it.doneAt && this.now() - it.doneAt > DONE_KEEP_MS) await store.outboxRemove(it.id);
    }

    let synced = 0;
    let paused: RunSummary["paused"] = null;
    try {
      for (let round = 0; round < 6; round += 1) {
        const items = await store.outboxList();
        const byGroup = new Map<string, OutboxItem[]>();
        for (const it of items) {
          if (it.status === "done") continue;
          const arr = byGroup.get(it.group) ?? [];
          arr.push(it);
          byGroup.set(it.group, arr);
        }
        const doneIds = new Set(items.filter((i) => i.status === "done").map((i) => i.id));
        const existingIds = new Set(items.map((i) => i.id));
        const groups = [...byGroup.values()];
        let progress = 0;
        let idx = 0;
        const worker = async () => {
          while (idx < groups.length) {
            const g = groups[idx++];
            for (const it of g) {
              if (it.status !== "pending") break; // failed/conflict: بقیه‌ی گروه مسدود
              if (it.nextTryAt > this.now()) break;
              if (it.dependsOn.some((dep) => existingIds.has(dep) && !doneIds.has(dep))) break;
              const ok = await this.sendOne(it);
              if (!ok) break;
              doneIds.add(it.id);
              progress += 1;
              synced += 1;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, this.d.concurrency ?? 3) }, worker));
        if (progress === 0) break;
      }
    } catch (e) {
      if (e instanceof PauseSignal) paused = e.reason;
      else throw e;
    }
    const summary = await this.summary(synced, paused);
    this.emit({ type: "change" });
    this.emit({ type: "summary", summary });
    return summary;
  }

  private async sendOne(original: OutboxItem): Promise<boolean> {
    const store = this.d.store;
    let item = original;

    // سیاست حداکثر عمر آفلاین: قدیمی‌تر از N روز بدون بازبینی صریح ارسال نمی‌شود
    const maxDays = this.d.maxOfflineDays?.() ?? 7;
    if (!item.reviewed && this.now() - Date.parse(item.createdAtDevice) > maxDays * 86_400_000) {
      await store.outboxUpdate({ ...item, status: "failed", lastErrorCode: "OFFLINE_TOO_OLD", lastError: `این مورد بیش از ${maxDays} روز پیش آفلاین ثبت شده؛ پیش از ارسال باید بازبینی شود` });
      return false;
    }

    // نگاشت‌های tmp_ که بعد از صف‌شدن حل شده‌اند
    const refs = new Set<string>([...findTmpIds(item.path), ...findTmpIds(item.body)]);
    if (refs.size) {
      const map: Record<string, string> = {};
      for (const t of refs) {
        const real = await store.tmpGet(t);
        if (real) map[t] = real;
      }
      if (Object.keys(map).length) {
        item = { ...item, path: replaceTmp(item.path, map), body: replaceTmp(item.body, map) };
        await store.outboxUpdate(item);
      }
      const left = new Set<string>([...findTmpIds(item.path), ...findTmpIds(item.body)]);
      if (left.size) {
        await store.outboxUpdate({ ...item, status: "failed", lastErrorCode: "DEPENDENCY_MISSING", lastError: "رکورد وابسته (که قرار بود ساخته شود) پیدا نشد یا حذف شده است" });
        return false;
      }
    }

    item = { ...item, status: "syncing", attempts: item.attempts + 1 };
    await store.outboxUpdate(item);

    let outcome: Outcome;
    try {
      outcome = await this.request(item);
    } catch (e) {
      // خطای شبکه
      const reachable = this.d.probe ? await this.d.probe().catch(() => false) : this.d.isOnline();
      if (!reachable) {
        await store.outboxUpdate({ ...item, status: "pending", attempts: item.attempts - 1 });
        this.emit({ type: "offline" });
        throw new PauseSignal("offline");
      }
      outcome = { kind: "retry", message: e instanceof Error ? e.message : "خطای شبکه" };
    }
    return this.apply(item, outcome);
  }

  private async apply(item: OutboxItem, o: Outcome): Promise<boolean> {
    const store = this.d.store;
    switch (o.kind) {
      case "ok": {
        const b = o.body as { id?: unknown } | null;
        const serverId = b && typeof b === "object" && typeof b.id === "string" ? b.id : null;
        await store.blobRemoveForItem(item.id);
        await store.outboxUpdate({ ...item, status: "done", body: null, blobIds: [], serverId, doneAt: this.now(), lastError: undefined, lastErrorCode: undefined });
        if (item.tempId && serverId) {
          await store.tmpSet(item.tempId, serverId);
          await this.rewriteDependents(item.id, item.tempId, serverId);
        }
        this.emit({ type: "change" });
        return true;
      }
      case "retry": {
        const max = this.d.maxAttempts ?? 12;
        if (item.attempts >= max) {
          await store.outboxUpdate({ ...item, status: "failed", lastError: `پس از ${item.attempts} تلاش ارسال نشد: ${o.message}`, lastErrorCode: "RETRY_EXHAUSTED" });
        } else {
          await store.outboxUpdate({ ...item, status: "pending", lastError: o.message, nextTryAt: this.now() + (o.afterMs ?? backoffMs(item.attempts, this.random)) });
        }
        return false;
      }
      case "auth": {
        await store.outboxUpdate({ ...item, status: "pending", attempts: item.attempts - 1 });
        this.authFailedToken = this.d.getToken();
        this.emit({ type: "auth-required" });
        throw new PauseSignal("auth");
      }
      case "conflict":
        await store.outboxUpdate({ ...item, status: "conflict", lastError: o.message, lastErrorCode: "STALE", serverUpdatedAt: o.serverUpdatedAt });
        return false;
      case "reject":
        await store.outboxUpdate({ ...item, status: "failed", httpStatus: o.status, lastError: o.message, lastErrorCode: o.code ?? `HTTP_${o.status}` });
        return false;
    }
  }

  private async rewriteDependents(creatorId: string, tmpId: string, realId: string) {
    const store = this.d.store;
    for (const it of await store.outboxList()) {
      if (it.id === creatorId || it.status === "done") continue;
      const text = JSON.stringify([it.path, it.body]);
      if (!text.includes(tmpId)) continue;
      await store.outboxUpdate({ ...it, path: replaceTmp(it.path, { [tmpId]: realId }), body: replaceTmp(it.body, { [tmpId]: realId }) });
    }
  }

  private async hydrate(body: unknown): Promise<unknown> {
    const walk = async (v: unknown): Promise<unknown> => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        if (typeof o.$blob === "string" && Object.keys(o).length === 1) {
          const b = await this.d.store.blobGet(o.$blob);
          if (!b) throw new Error("فایل پیوست صف پیدا نشد");
          return `data:${b.type};base64,${toBase64(b.data)}`;
        }
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(o)) out[k] = await walk(x);
        return out;
      }
      if (Array.isArray(v)) return Promise.all(v.map(walk));
      return v;
    };
    return walk(body);
  }

  /** یک درخواست؛ خطای شبکه throw می‌شود، پاسخ HTTP طبقه‌بندی می‌گردد. */
  private async request(item: OutboxItem): Promise<Outcome> {
    const token = this.d.getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": item.idempotencyKey,
      "X-Offline-Created-At": item.createdAtDevice,
      "X-Offline-Op": item.opKey,
      "X-Client-Time": new Date(this.now()).toISOString(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (this.d.device) headers["X-Offline-Device"] = this.d.device;
    if (item.baseUpdatedAt) headers["X-Base-Updated-At"] = item.baseUpdatedAt;
    if (item.reviewed) headers["X-Offline-Reviewed"] = "1";

    let body: string | undefined;
    if (item.body !== null && item.body !== undefined) {
      try {
        body = JSON.stringify(await this.hydrate(item.body));
      } catch (e) {
        return { kind: "reject", status: 0, message: e instanceof Error ? e.message : "پیوست پیدا نشد", code: "BLOB_MISSING" };
      }
    }
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.d.requestTimeoutMs ?? 90_000) : null;
    let res: Response;
    try {
      res = await this.d.fetchImpl(`${this.d.apiUrl}${item.path}`, { method: item.method, headers, body, cache: "no-store", signal: ctl?.signal });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.ok) {
      let parsed: unknown = null;
      if (res.status !== 204) parsed = await res.json().catch(() => null);
      return { kind: "ok", body: parsed };
    }
    let payload: { message?: unknown; code?: unknown; currentUpdatedAt?: unknown } = {};
    try {
      payload = (await res.json()) ?? {};
    } catch {
      /* no body */
    }
    const message = typeof payload.message === "string" ? payload.message : "درخواست توسط سرور پذیرفته نشد";
    const code = typeof payload.code === "string" ? payload.code : undefined;
    const s = res.status;
    if (s === 401) return { kind: "auth" };
    if (s === 409) {
      if (code === "IDEMPOTENCY_IN_PROGRESS") return { kind: "retry", message, afterMs: 2000 };
      const op = matchOp(item.method, item.path, undefined);
      if (code === "STALE") return { kind: "conflict", message, serverUpdatedAt: typeof payload.currentUpdatedAt === "string" ? payload.currentUpdatedAt : undefined };
      if (op?.op.conflict === "slot") return { kind: "conflict", message };
      return { kind: "reject", status: s, message, code };
    }
    if (s === 404 && item.method === "DELETE") return { kind: "ok", body: null };
    if (s === 429) {
      const ra = Number(res.headers.get("Retry-After"));
      return { kind: "retry", message, afterMs: Number.isFinite(ra) && ra > 0 ? Math.min(ra, 900) * 1000 : undefined };
    }
    if (s === 408 || s === 425 || s >= 500) return { kind: "retry", message };
    return { kind: "reject", status: s, message, code };
  }

  // ── اقدام کاربر روی موارد صف ────────────────────────────────────────────
  async retry(id: string): Promise<void> {
    const it = await this.d.store.outboxGet(id);
    if (!it || it.status === "done") return;
    await this.d.store.outboxUpdate({ ...it, status: "pending", attempts: 0, nextTryAt: 0, lastError: undefined, lastErrorCode: undefined });
    this.emit({ type: "change" });
  }

  /** تأیید صریح مورد قدیمی‌تر از سیاست و ارسال */
  async review(id: string): Promise<void> {
    const it = await this.d.store.outboxGet(id);
    if (!it) return;
    await this.d.store.outboxUpdate({ ...it, reviewed: true, status: "pending", attempts: 0, nextTryAt: 0, lastError: undefined, lastErrorCode: undefined });
    this.emit({ type: "change" });
  }

  /** ویرایش بدنه و ارسال دوباره (کلید Idempotency جدید چون هش درخواست عوض شده). */
  async editAndRetry(id: string, body: unknown): Promise<void> {
    const it = await this.d.store.outboxGet(id);
    if (!it) return;
    const { body: slim, blobs } = extractBlobs(body, this.newId);
    if (blobs.length) throw new OfflineLimitError("افزودن فایل جدید هنگام ویرایش صف پشتیبانی نمی‌شود");
    await this.d.store.outboxUpdate({
      ...it,
      body: slim,
      idempotencyKey: this.newId().replace(/-/g, "") + this.newId().replace(/-/g, "").slice(0, 8),
      status: "pending",
      attempts: 0,
      nextTryAt: 0,
      lastError: undefined,
      lastErrorCode: undefined,
    });
    this.emit({ type: "change" });
  }

  /** دور انداختن مورد (UI تأیید می‌گیرد). موارد وابسته به آن «ناموفق» علامت می‌خورند، نه حذف بی‌صدا. */
  async discard(id: string): Promise<void> {
    const store = this.d.store;
    const it = await store.outboxGet(id);
    if (!it) return;
    await store.outboxRemove(id);
    for (const other of await store.outboxList()) {
      if (other.status !== "done" && other.dependsOn.includes(id)) {
        await store.outboxUpdate({ ...other, status: "failed", lastErrorCode: "DEPENDENCY_DISCARDED", lastError: "مورد وابسته‌ی این درخواست دور انداخته شد" });
      }
    }
    this.emit({ type: "change" });
  }

  /** حل تعارض: mine = نسخه‌ی من روی نسخه‌ی فعلی سرور؛ server = نسخه‌ی من دور ریخته شود؛ merged = بدنه‌ی ادغام‌شده. */
  async resolveConflict(id: string, choice: { kind: "mine" } | { kind: "server" } | { kind: "merged"; body: unknown }): Promise<void> {
    const store = this.d.store;
    const it = await store.outboxGet(id);
    if (!it || it.status !== "conflict") return;
    if (choice.kind === "server") return this.discard(id);
    await store.outboxUpdate({
      ...it,
      body: choice.kind === "merged" ? choice.body : it.body,
      baseUpdatedAt: it.serverUpdatedAt ?? null,
      idempotencyKey: this.newId().replace(/-/g, "") + this.newId().replace(/-/g, "").slice(0, 8),
      status: "pending",
      attempts: 0,
      nextTryAt: 0,
      lastError: undefined,
      lastErrorCode: undefined,
    });
    this.emit({ type: "change" });
  }
}
