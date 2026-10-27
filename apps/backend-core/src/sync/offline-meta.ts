import type { OfflineMeta } from './idempotency.js';

/** فراداده‌ی آفلاین هر درخواست (فقط وقتی ماژول فعال است توسط IdempotencyInterceptor ثبت می‌شود)؛ AuditInterceptor آن را در متادیتای لاگ می‌گذارد. */
const store = new WeakMap<object, OfflineMeta>();

export function setOfflineMeta(req: object, meta: OfflineMeta): void {
  store.set(req, meta);
}

export function getOfflineMeta(req: object): OfflineMeta | undefined {
  return store.get(req);
}
