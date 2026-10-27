/** پوشش بسیار کوچک و دست‌نویس روی IndexedDB (بدون وابستگی). factory تزریق می‌شود تا در آزمون fake-indexeddb باشد. */

export type StoreName = "outbox" | "cache" | "blobs" | "keys" | "meta";

const STORES: Array<{ name: StoreName; keyPath: string; indexes?: Array<[string, string]> }> = [
  { name: "outbox", keyPath: "id", indexes: [["scope", "scope"]] },
  { name: "cache", keyPath: "id", indexes: [["scope", "scope"]] },
  { name: "blobs", keyPath: "id", indexes: [["scope", "scope"]] },
  { name: "keys", keyPath: "scope" },
  { name: "meta", keyPath: "id" },
];

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"));
  });
}

export class TxStore {
  constructor(private readonly s: IDBObjectStore) {}
  get<T>(key: IDBValidKey): Promise<T | undefined> {
    return wrap(this.s.get(key)) as Promise<T | undefined>;
  }
  put(value: unknown): Promise<IDBValidKey> {
    return wrap(this.s.put(value));
  }
  delete(key: IDBValidKey): Promise<undefined> {
    return wrap(this.s.delete(key)) as Promise<undefined>;
  }
  getAllByIndex<T>(index: string, key: IDBValidKey): Promise<T[]> {
    return wrap(this.s.index(index).getAll(key)) as Promise<T[]>;
  }
  getAll<T>(): Promise<T[]> {
    return wrap(this.s.getAll()) as Promise<T[]>;
  }
}

export class IdbDb {
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory,
    private readonly name = "exir-offline-v2",
    private readonly version = 1,
  ) {}

  private open(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise<IDBDatabase>((resolve, reject) => {
        const req = this.factory.open(this.name, this.version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const s of STORES) {
            if (db.objectStoreNames.contains(s.name)) continue;
            const os = db.createObjectStore(s.name, { keyPath: s.keyPath });
            for (const [iname, kp] of s.indexes ?? []) os.createIndex(iname, kp);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onversionchange = () => {
            db.close();
            this.dbp = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          this.dbp = null;
          reject(req.error ?? new Error("IndexedDB open failed"));
        };
        req.onblocked = () => reject(new Error("IndexedDB blocked"));
      });
    }
    return this.dbp;
  }

  /** تراکنش اتمیک. داخل fn فقط درخواست‌های IDB را await کنید (کار async دیگر تراکنش را می‌بندد). */
  async tx<T>(names: StoreName[], mode: IDBTransactionMode, fn: (s: Record<StoreName, TxStore>) => Promise<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result: T;
      let failed = false;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => {
        failed = true;
        reject(tx.error ?? new Error("IndexedDB transaction failed"));
      };
      tx.onabort = () => {
        if (!failed) reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      };
      const stores = {} as Record<StoreName, TxStore>;
      for (const n of names) stores[n] = new TxStore(tx.objectStore(n));
      fn(stores).then(
        (r) => {
          result = r;
        },
        (e) => {
          failed = true;
          try {
            tx.abort();
          } catch {
            /* already finished */
          }
          reject(e);
        },
      );
    });
  }

  async close(): Promise<void> {
    if (!this.dbp) return;
    const db = await this.dbp;
    db.close();
    this.dbp = null;
  }

  async deleteDatabase(): Promise<void> {
    await this.close();
    await new Promise<void>((resolve, reject) => {
      const r = this.factory.deleteDatabase(this.name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve();
    });
  }
}
