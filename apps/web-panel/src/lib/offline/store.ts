import { generateDataKey, openBytes, openJson, sealBytes, sealJson, type Sealed } from "./crypto";
import { IdbDb } from "./idb";
import type { Identity, OutboxItem, OutboxStatus } from "./types";

/**
 * ذخیره‌ی دستگاه: outbox (هرگز خودکار حذف نمی‌شود)، cache (LRU/TTL/سقف حجم)، blobs (فایل‌های صف)، keys، meta.
 * همه‌ی خواندن/نوشتن‌ها به scope = «tenantId:userId» محدود است؛ کاربر دیگر در همان مرورگر نه می‌بیند و نه (بدون کلید) می‌تواند رمزگشایی کند.
 */

export const scopeOf = (i: Identity) => `${i.tenantId}:${i.userId}`;

type OutboxRow = {
  id: string;
  scope: string;
  status: OutboxStatus;
  seq: number;
  nextTryAt: number;
  createdAtDevice: string;
  attempts: number;
  v: number;
  iv: Uint8Array;
  ct: ArrayBuffer;
};

type CacheRow = {
  id: string;
  scope: string;
  key: string;
  entity: string;
  storedAt: number;
  lastAccess: number;
  size: number;
  ttlMs: number;
  iv: Uint8Array;
  ct: ArrayBuffer;
};

type BlobRow = { id: string; scope: string; itemId: string; type: string; name: string; size: number; iv: Uint8Array; ct: ArrayBuffer };
type MetaRow = { id: string; value: unknown };
type KeyRow = { scope: string; key: CryptoKey; createdAt: number };

/**
 * فقط شمارنده‌ها/وضعیت/زمان به‌صورت متن‌ساده روی ردیف می‌مانند (برای آمار بدون کلید). group (که شناسه‌ی رکورد/کارمند دارد)،
 * opKey، مسیر، بدنه و برچسب همه رمز می‌شوند.
 */
type Secret = Omit<OutboxItem, "id" | "seq" | "status" | "nextTryAt" | "createdAtDevice" | "attempts">;

export type CacheLimits = { maxBytes: number; maxEntries: number; maxAgeMs: number };
export const DEFAULT_CACHE_LIMITS: CacheLimits = { maxBytes: 40 * 1024 * 1024, maxEntries: 400, maxAgeMs: 30 * 24 * 3600 * 1000 };

export type StorageUsage = {
  outboxCount: number;
  outboxBytes: number;
  blobBytes: number;
  cacheCount: number;
  cacheBytes: number;
};

export class OfflineStore {
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(
    readonly db: IdbDb,
    readonly identity: Identity,
    private readonly c: Crypto = globalThis.crypto,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get scope(): string {
    return scopeOf(this.identity);
  }

  // ── کلید ──
  private getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = (async () => {
        const existing = await this.db.tx(["keys"], "readonly", (s) => s.keys.get<KeyRow>(this.scope));
        if (existing) return existing.key;
        const fresh = await generateDataKey(this.c);
        // اگر هم‌زمان تب دیگری ساخته بود، همان را استفاده کن (برنده‌ی اولین نوشتن)
        return this.db.tx(["keys"], "readwrite", async (s) => {
          const again = await s.keys.get<KeyRow>(this.scope);
          if (again) return again.key;
          await s.keys.put({ scope: this.scope, key: fresh, createdAt: this.now() } satisfies KeyRow);
          return fresh;
        });
      })().catch((e) => {
        this.keyPromise = null;
        throw e;
      });
    }
    return this.keyPromise;
  }

  async hasKey(): Promise<boolean> {
    return !!(await this.db.tx(["keys"], "readonly", (s) => s.keys.get<KeyRow>(this.scope)));
  }

  private aad(kind: string, id: string) {
    return `${this.scope}|${kind}|${id}`;
  }

  // ── meta ──
  async metaGet<T>(name: string): Promise<T | undefined> {
    const row = await this.db.tx(["meta"], "readonly", (s) => s.meta.get<MetaRow>(`${this.scope}|${name}`));
    return row?.value as T | undefined;
  }
  async metaSet(name: string, value: unknown): Promise<void> {
    await this.db.tx(["meta"], "readwrite", (s) => s.meta.put({ id: `${this.scope}|${name}`, value } satisfies MetaRow).then(() => undefined));
  }

  async nextSeq(): Promise<number> {
    return this.db.tx(["meta"], "readwrite", async (s) => {
      const id = `${this.scope}|seq`;
      const row = await s.meta.get<MetaRow>(id);
      const n = ((row?.value as number | undefined) ?? 0) + 1;
      await s.meta.put({ id, value: n } satisfies MetaRow);
      return n;
    });
  }

  // ── شناسه‌های موقت ──
  async tmpSet(tmpId: string, realId: string): Promise<void> {
    await this.metaSet(`tmp|${tmpId}`, realId);
  }
  async tmpGet(tmpId: string): Promise<string | undefined> {
    return this.metaGet<string>(`tmp|${tmpId}`);
  }

  // ── outbox ──
  private async toRow(item: OutboxItem): Promise<OutboxRow> {
    const { id, seq, status, nextTryAt, createdAtDevice, attempts, ...secret } = item;
    const sealed = await sealJson(await this.getKey(), secret satisfies Secret, this.aad("outbox", id), this.c);
    return { id, scope: this.scope, status, seq, nextTryAt, createdAtDevice, attempts, v: item.schemaVersion, iv: sealed.iv, ct: sealed.ct };
  }

  private async fromRow(row: OutboxRow): Promise<OutboxItem> {
    const secret = await openJson<Secret>(await this.getKey(), { iv: row.iv, ct: row.ct }, this.aad("outbox", row.id), this.c);
    return { ...secret, id: row.id, seq: row.seq, status: row.status, nextTryAt: row.nextTryAt, createdAtDevice: row.createdAtDevice, attempts: row.attempts };
  }

  /** افزودن اتمیک یک مورد + فایل‌هایش (همه یا هیچ). */
  async outboxAdd(item: OutboxItem, blobs: Array<{ id: string; type: string; name: string; data: ArrayBuffer }> = []): Promise<void> {
    const row = await this.toRow(item);
    const key = await this.getKey();
    const blobRows: BlobRow[] = [];
    for (const b of blobs) {
      const sealed = await sealBytes(key, b.data, this.aad("blob", b.id), this.c);
      blobRows.push({ id: b.id, scope: this.scope, itemId: item.id, type: b.type, name: b.name, size: b.data.byteLength, iv: sealed.iv, ct: sealed.ct });
    }
    await this.db.tx(["outbox", "blobs"], "readwrite", async (s) => {
      await s.outbox.put(row);
      for (const b of blobRows) await s.blobs.put(b);
    });
  }

  async outboxUpdate(item: OutboxItem): Promise<void> {
    const row = await this.toRow(item);
    await this.db.tx(["outbox"], "readwrite", async (s) => {
      const existing = await s.outbox.get<OutboxRow>(item.id);
      if (!existing || existing.scope !== this.scope) throw new Error("outbox item not found");
      await s.outbox.put(row);
    });
  }

  async outboxList(): Promise<OutboxItem[]> {
    const rows = await this.db.tx(["outbox"], "readonly", (s) => s.outbox.getAllByIndex<OutboxRow>("scope", this.scope));
    rows.sort((a, b) => a.seq - b.seq);
    const out: OutboxItem[] = [];
    for (const r of rows) {
      try {
        out.push(await this.fromRow(r));
      } catch {
        // رکورد خراب/بدون کلید: نمایش داده نمی‌شود ولی حذف هم نمی‌شود (هرگز از دست رفتن بی‌صدا)
      }
    }
    return out;
  }

  async outboxGet(id: string): Promise<OutboxItem | undefined> {
    const row = await this.db.tx(["outbox"], "readonly", (s) => s.outbox.get<OutboxRow>(id));
    if (!row || row.scope !== this.scope) return undefined;
    return this.fromRow(row);
  }

  /** شمارش بدون نیاز به کلید/رمزگشایی */
  async outboxCounts(): Promise<Record<OutboxStatus, number>> {
    const rows = await this.db.tx(["outbox"], "readonly", (s) => s.outbox.getAllByIndex<OutboxRow>("scope", this.scope));
    const c: Record<OutboxStatus, number> = { pending: 0, syncing: 0, failed: 0, conflict: 0, done: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }

  async outboxRemove(id: string): Promise<void> {
    await this.db.tx(["outbox", "blobs"], "readwrite", async (s) => {
      const row = await s.outbox.get<OutboxRow>(id);
      if (!row || row.scope !== this.scope) return;
      const blobs = await s.blobs.getAllByIndex<BlobRow>("scope", this.scope);
      for (const b of blobs) if (b.itemId === id) await s.blobs.delete(b.id);
      await s.outbox.delete(id);
    });
  }

  async blobGet(id: string): Promise<{ data: ArrayBuffer; type: string; name: string } | undefined> {
    const row = await this.db.tx(["blobs"], "readonly", (s) => s.blobs.get<BlobRow>(id));
    if (!row || row.scope !== this.scope) return undefined;
    const data = await openBytes(await this.getKey(), { iv: row.iv, ct: row.ct } as Sealed, this.aad("blob", id), this.c);
    return { data, type: row.type, name: row.name };
  }

  async blobRemoveForItem(itemId: string): Promise<void> {
    await this.db.tx(["blobs"], "readwrite", async (s) => {
      for (const b of await s.blobs.getAllByIndex<BlobRow>("scope", this.scope)) if (b.itemId === itemId) await s.blobs.delete(b.id);
    });
  }

  // ── cache ──
  async cachePut(key: string, value: unknown, opts: { entity: string; ttlMs: number }): Promise<void> {
    const id = `${this.scope}|${key}`;
    const sealed = await sealJson(await this.getKey(), value, this.aad("cache", id), this.c);
    const t = this.now();
    const row: CacheRow = { id, scope: this.scope, key, entity: opts.entity, storedAt: t, lastAccess: t, size: sealed.ct.byteLength, ttlMs: opts.ttlMs, iv: sealed.iv, ct: sealed.ct };
    await this.db.tx(["cache"], "readwrite", (s) => s.cache.put(row).then(() => undefined));
  }

  /** خواندن؛ allowStale=true هنگام آفلاین (داده‌ی منقضی بهتر از هیچ). null = نبود، یا منقضی و allowStale=false. */
  async cacheGet<T>(key: string, allowStale = false): Promise<{ value: T; storedAt: number; stale: boolean } | null> {
    const id = `${this.scope}|${key}`;
    const row = await this.db.tx(["cache"], "readonly", (s) => s.cache.get<CacheRow>(id));
    if (!row || row.scope !== this.scope) return null;
    const stale = this.now() - row.storedAt > row.ttlMs;
    if (stale && !allowStale) return null;
    let value: T;
    try {
      value = await openJson<T>(await this.getKey(), { iv: row.iv, ct: row.ct }, this.aad("cache", id), this.c);
    } catch {
      return null;
    }
    // به‌روزرسانی LRU (بهترین تلاش)
    void this.db.tx(["cache"], "readwrite", async (s) => {
      const cur = await s.cache.get<CacheRow>(id);
      if (cur) await s.cache.put({ ...cur, lastAccess: this.now() });
    }).catch(() => undefined);
    return { value, storedAt: row.storedAt, stale };
  }

  async cacheDelete(key: string): Promise<void> {
    await this.db.tx(["cache"], "readwrite", (s) => s.cache.delete(`${this.scope}|${key}`).then(() => undefined));
  }

  /**
   * سیاست خروج کش: ۱) منقضی‌های بسیار قدیمی ۲) LRU تا زیر سقف حجم/تعداد. فقط جدول cache را لمس می‌کند — outbox/blobs هرگز.
   * برمی‌گرداند چند ردیف حذف شد.
   */
  async cacheEvict(limits: CacheLimits = DEFAULT_CACHE_LIMITS): Promise<number> {
    return this.db.tx(["cache"], "readwrite", async (s) => {
      const rows = await s.cache.getAllByIndex<CacheRow>("scope", this.scope);
      const t = this.now();
      let removed = 0;
      const keep: CacheRow[] = [];
      for (const r of rows) {
        if (t - r.storedAt > limits.maxAgeMs) {
          await s.cache.delete(r.id);
          removed += 1;
        } else keep.push(r);
      }
      keep.sort((a, b) => a.lastAccess - b.lastAccess); // قدیمی‌ترین دسترسی اول
      let bytes = keep.reduce((n, r) => n + r.size, 0);
      let count = keep.length;
      for (const r of keep) {
        if (bytes <= limits.maxBytes && count <= limits.maxEntries) break;
        await s.cache.delete(r.id);
        bytes -= r.size;
        count -= 1;
        removed += 1;
      }
      return removed;
    });
  }

  async usage(): Promise<StorageUsage> {
    return this.db.tx(["outbox", "blobs", "cache"], "readonly", async (s) => {
      const [o, b, c] = await Promise.all([
        s.outbox.getAllByIndex<OutboxRow>("scope", this.scope),
        s.blobs.getAllByIndex<BlobRow>("scope", this.scope),
        s.cache.getAllByIndex<CacheRow>("scope", this.scope),
      ]);
      return {
        outboxCount: o.length,
        outboxBytes: o.reduce((n, r) => n + r.ct.byteLength, 0),
        blobBytes: b.reduce((n, r) => n + r.size, 0),
        cacheCount: c.length,
        cacheBytes: c.reduce((n, r) => n + r.size, 0),
      };
    });
  }

  // ── پاک‌سازی ──
  async wipeCache(): Promise<void> {
    await this.db.tx(["cache"], "readwrite", async (s) => {
      for (const r of await s.cache.getAllByIndex<CacheRow>("scope", this.scope)) await s.cache.delete(r.id);
    });
  }

  /**
   * پاک‌سازی کامل این کاربر: کش + (اختیاری) صف + کلید.
   * keepOutbox=true → فقط کش پاک می‌شود و کلید می‌ماند تا صف در ورود بعدیِ همان کاربر خوانا بماند.
   */
  async wipe(opts: { keepOutbox: boolean }): Promise<void> {
    await this.wipeCache();
    if (opts.keepOutbox) return;
    await this.db.tx(["outbox", "blobs", "keys", "meta"], "readwrite", async (s) => {
      for (const r of await s.outbox.getAllByIndex<OutboxRow>("scope", this.scope)) await s.outbox.delete(r.id);
      for (const r of await s.blobs.getAllByIndex<BlobRow>("scope", this.scope)) await s.blobs.delete(r.id);
      for (const m of await s.meta.getAll<MetaRow>()) if (m.id.startsWith(`${this.scope}|`)) await s.meta.delete(m.id);
      await s.keys.delete(this.scope);
    });
    this.keyPromise = null;
  }
}
