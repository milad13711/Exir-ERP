/**
 * پل بین صفحه‌ی /support?ticket=ID (لینک اعلان‌ها) و پنل چت پشتیبانی داخل AppShell.
 * صفحه‌ی فرزند پیش از افکت والد اجرا می‌شود، پس درخواست را در یک متغیر ماژولی نگه می‌داریم
 * تا AppShell هنگام mount آن را بردارد (و در ادامه با subscribe هم کار کند).
 */
export type SupportOpenRequest = { ticketId: string | null };

let pending: SupportOpenRequest | null = null;
const listeners = new Set<(r: SupportOpenRequest) => void>();

export function requestSupportOpen(req: SupportOpenRequest): void {
  if (listeners.size === 0) {
    pending = req;
    return;
  }
  listeners.forEach((l) => l(req));
}

export function subscribeSupportOpen(listener: (r: SupportOpenRequest) => void): () => void {
  listeners.add(listener);
  if (pending) {
    const p = pending;
    pending = null;
    listener(p);
  }
  return () => {
    listeners.delete(listener);
  };
}
