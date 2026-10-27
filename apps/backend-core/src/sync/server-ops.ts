/**
 * نگاشت سمت سرور «متد + مسیر (+ شکل بدنه)» → کلید عملیات آفلاین. سرور هرگز به هدر X-Offline-Op اعتماد نمی‌کند:
 * op از روی مسیر واقعی تعیین می‌شود. همین فهرست مسیرهای «امن برای ذخیره‌ی بدنه‌ی پاسخ Idempotency» هم هست (whitelist) —
 * هر مسیر دیگری (مثلاً /settings/webhooks که راز برمی‌گرداند) فقط status + id ذخیره می‌کند.
 * باید با web-panel/src/lib/offline/registry.ts هم‌خوان بماند (تست parity کلیدها).
 */
const ID = '[0-9a-zA-Z_-]{1,64}';
type Rule = { key: string; method: string; re: RegExp; when?: (body: unknown) => boolean };
const rec = (b: unknown): Record<string, unknown> => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});

const RULES: Rule[] = [
  { key: 'hr.attendance.mark', method: 'POST', re: /^\/hr\/attendance$/ },
  { key: 'checklist.toggle', method: 'PATCH', re: new RegExp(`^/daily-checklist/${ID}$`), when: (b) => { const k = Object.keys(rec(b)); return k.length > 0 && k.every((x) => x === 'done'); } },
  { key: 'checklist.update', method: 'PATCH', re: new RegExp(`^/daily-checklist/${ID}$`) },
  { key: 'checklist.create', method: 'POST', re: /^\/daily-checklist$/ },
  { key: 'tasks.create', method: 'POST', re: /^\/tasks$/ },
  { key: 'tasks.update', method: 'PATCH', re: new RegExp(`^/tasks/${ID}$`) },
  { key: 'tasks.start', method: 'POST', re: new RegExp(`^/tasks/${ID}/start$`) },
  { key: 'tasks.result', method: 'POST', re: new RegExp(`^/tasks/${ID}/result$`) },
  { key: 'tasks.comment', method: 'POST', re: new RegExp(`^/tasks/${ID}/comments$`) },
  { key: 'crm.contact.create', method: 'POST', re: /^\/crm\/contacts$/ },
  { key: 'crm.contact.update', method: 'PUT', re: new RegExp(`^/crm/contacts/${ID}$`) },
  { key: 'crm.activity.add', method: 'POST', re: new RegExp(`^/crm/contacts/${ID}/activities$`) },
  { key: 'reminders.create', method: 'POST', re: /^\/dashboard\/reminders$/ },
  { key: 'reminders.update', method: 'PATCH', re: new RegExp(`^/dashboard/reminders/${ID}$`) },
  { key: 'reminders.done', method: 'POST', re: new RegExp(`^/dashboard/reminders/${ID}/done$`) },
  { key: 'sales.invoice.draft.create', method: 'POST', re: /^\/sales\/invoices$/, when: (b) => !rec(b).isOfficial },
  { key: 'sales.invoice.draft.update', method: 'PUT', re: new RegExp(`^/sales/invoices/${ID}$`), when: (b) => !rec(b).isOfficial },
  { key: 'sales.quotation.create', method: 'POST', re: /^\/sales\/quotations$/ },
  { key: 'sales.quotation.update', method: 'PATCH', re: new RegExp(`^/sales/quotations/${ID}$`) },
  { key: 'booking.appointment.create', method: 'POST', re: /^\/booking\/appointments$/ },
  { key: 'correspondence.incoming.register', method: 'POST', re: /^\/correspondence\/letters\/incoming$/ },
  { key: 'projects.note.add', method: 'POST', re: new RegExp(`^/projects/${ID}/notes$`) },
];

export const SERVER_OP_KEYS = RULES.map((r) => r.key);

export function normalizeApiPath(path: string): string {
  return (path ?? '').split('?')[0].replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
}

/** op را از روی متد+مسیر+بدنه پیدا می‌کند؛ null = عملیات آفلاین‌پذیر نیست. */
export function matchServerOp(method: string, path: string, body: unknown): string | null {
  const p = normalizeApiPath(path);
  const m = method.toUpperCase();
  for (const r of RULES) if (r.method === m && r.re.test(p) && (!r.when || r.when(body))) return r.key;
  return null;
}

/** آیا بدنه‌ی پاسخ این مسیر مجاز به ذخیره (برای بازپخش) است؟ فقط مسیرهای رجیستری. */
export function canStoreResponseBody(method: string, path: string): boolean {
  const p = normalizeApiPath(path);
  const m = method.toUpperCase();
  return RULES.some((r) => r.method === m && r.re.test(p));
}
