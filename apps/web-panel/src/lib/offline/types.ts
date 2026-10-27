/**
 * انواع مشترک موتور کار آفلاین. این فایل‌ها (src/lib/offline/*.ts به‌جز hook/UI) عمداً «خالص» نوشته شده‌اند —
 * فقط importِ نسبی و بدون React/Next — تا از بک‌اند (vitest) با fake-indexeddb آزمون شوند.
 */

export type OutboxStatus = "pending" | "syncing" | "failed" | "conflict" | "done";
export type OpKind = "CREATE" | "UPDATE" | "ACTION";

export type Identity = { tenantId: string; userId: string };

/** بدنه‌ی صف: رشته‌های بزرگ data-URI به رکورد جدا (blob) منتقل و اینجا با {"$blob": id} جایگزین می‌شوند. */
export type BlobRef = { $blob: string };

export type OutboxItem = {
  id: string;
  seq: number;
  idempotencyKey: string;
  opKey: string;
  kind: OpKind;
  method: string;
  /** مسیر API (بدون پیشوند /api) با کوئری */
  path: string;
  body: unknown;
  blobIds: string[];
  /** گروه وابستگی: داخل یک گروه ترتیبی، بین گروه‌ها موازی */
  group: string;
  dependsOn: string[];
  /** اگر این مورد رکورد جدید می‌سازد، شناسه‌ی موقتی که بقیه به آن ارجاع می‌دهند */
  tempId?: string;
  baseUpdatedAt?: string | null;
  label: string;
  createdAtDevice: string;
  attempts: number;
  nextTryAt: number;
  status: OutboxStatus;
  lastError?: string;
  lastErrorCode?: string;
  httpStatus?: number;
  /** پس از «بازبینی صریح» برای موارد قدیمی‌تر از سیاست */
  reviewed?: boolean;
  serverId?: string | null;
  /** updatedAt فعلی سرور هنگام تعارض STALE */
  serverUpdatedAt?: string;
  doneAt?: number;
  schemaVersion: number;
};

export const OUTBOX_SCHEMA_VERSION = 1;

export type RunSummary = { synced: number; failed: number; conflicts: number; remaining: number; paused: null | "offline" | "auth" };
