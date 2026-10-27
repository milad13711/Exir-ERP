import type { OpKind } from "./types";

/**
 * رجیستری صریح عملیات آفلاین‌پذیر (v1). فقط درخواستی که اینجا تطبیق بخورد و ماژول نصب باشد صف می‌شود؛
 * هر چیز دیگر هنگام آفلاین‌بودن با پیام «نیازمند اتصال» رد می‌شود. کلیدها باید با OFFLINE_OPERATION_KEYS بک‌اند
 * (src/sync/sync-policy.ts) یکی باشد — تست parity آن را تضمین می‌کند.
 */

export type ConflictPolicy = "none" | "stale" | "slot";

export type OfflineOp = {
  key: string;
  label: string;
  /** ماژول مالک (برای فیلتر نصب‌بودن در UI) */
  module: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  pattern: RegExp;
  kind: OpKind;
  /** stale = هدر X-Base-Updated-At؛ slot = هر ۴۰۹ یعنی تعارض (مثلاً اسلات رزرو پر شده) */
  conflict: ConflictPolicy;
  requiresOnline: false;
  /** شرط اضافه روی بدنه (مثلاً فاکتور رسمی آفلاین نمی‌شود) */
  when?: (body: unknown) => boolean;
  /** کلید موجودیتی که این عملیات روی آن است (برای گروه‌بندی ترتیبی) */
  entity?: (m: RegExpExecArray, body: unknown) => string | null;
  /** موجودیتی که این عملیات می‌سازد (برای نگاشت tmp_ ← id واقعی) */
  creates?: boolean;
  /** فیلدهای قابل ادغام فیلد‌به‌فیلد در حل تعارض (رکوردهای ساده) */
  mergeFields?: Array<{ field: string; label: string }>;
  /** GET برای دریافت نسخه‌ی فعلی سرور هنگام حل تعارض (از مسیر عملیات) */
  currentPath?: (path: string) => string | null;
  /** عنوان فارسی نمایشی مورد صف */
  describe?: (body: unknown) => string;
  /** افزودنی‌های نتیجه‌ی خوش‌بینانه */
  optimisticNote?: string;
};

const rec = (b: unknown): Record<string, unknown> => (b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const ID = "([0-9a-zA-Z_-]{1,64})";

export const OFFLINE_OPS: OfflineOp[] = [
  {
    key: "hr.attendance.mark",
    label: "ثبت حضور و غیاب",
    module: "hr",
    method: "POST",
    pattern: /^\/hr\/attendance$/,
    kind: "ACTION",
    conflict: "none",
    requiresOnline: false,
    entity: (_m, b) => `attendance:${str(rec(b).employeeId)}:${str(rec(b).date).slice(0, 10)}`,
    describe: (b) => `حضور و غیاب ${str(rec(b).date).slice(0, 10)}`,
  },
  {
    key: "checklist.toggle",
    label: "تیک چک‌لیست",
    module: "daily-checklist",
    method: "PATCH",
    pattern: new RegExp(`^/daily-checklist/${ID}$`),
    kind: "UPDATE",
    conflict: "stale",
    requiresOnline: false,
    when: (b) => {
      const keys = Object.keys(rec(b));
      return keys.length > 0 && keys.every((k) => k === "done");
    },
    entity: (m) => `checklist:${m[1]}`,
    describe: (b) => (rec(b).done ? "انجام‌شد: چک‌لیست" : "بازگشت چک‌لیست به انجام‌نشده"),
    currentPath: () => null,
  },
  {
    key: "checklist.update",
    label: "ویرایش آیتم چک‌لیست",
    module: "daily-checklist",
    method: "PATCH",
    pattern: new RegExp(`^/daily-checklist/${ID}$`),
    kind: "UPDATE",
    conflict: "stale",
    requiresOnline: false,
    entity: (m) => `checklist:${m[1]}`,
    mergeFields: [
      { field: "title", label: "عنوان" },
      { field: "description", label: "توضیحات" },
    ],
    describe: (b) => `ویرایش چک‌لیست ${str(rec(b).title)}`.trim(),
  },
  {
    key: "checklist.create",
    label: "آیتم جدید چک‌لیست",
    module: "daily-checklist",
    method: "POST",
    pattern: /^\/daily-checklist$/,
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    creates: true,
    describe: (b) => `چک‌لیست: ${str(rec(b).title)}`,
  },
  {
    key: "tasks.create",
    label: "وظیفه‌ی جدید",
    module: "tasks",
    method: "POST",
    pattern: /^\/tasks$/,
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    creates: true,
    describe: (b) => `وظیفه: ${str(rec(b).title)}`,
    optimisticNote: "شماره‌ی وظیفه پس از همگام‌سازی تعیین می‌شود",
  },
  {
    key: "tasks.update",
    label: "ویرایش وظیفه",
    module: "tasks",
    method: "PATCH",
    pattern: new RegExp(`^/tasks/${ID}$`),
    kind: "UPDATE",
    conflict: "stale",
    requiresOnline: false,
    entity: (m) => `task:${m[1]}`,
    mergeFields: [
      { field: "title", label: "عنوان" },
      { field: "description", label: "توضیحات" },
    ],
    currentPath: (p) => p.split("?")[0],
    describe: (b) => `ویرایش وظیفه ${str(rec(b).title)}`.trim(),
  },
  {
    key: "tasks.start",
    label: "شروع وظیفه",
    module: "tasks",
    method: "POST",
    pattern: new RegExp(`^/tasks/${ID}/start$`),
    kind: "ACTION",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `task:${m[1]}`,
    describe: () => "شروع وظیفه",
  },
  {
    key: "tasks.result",
    label: "ثبت نتیجه‌ی وظیفه",
    module: "tasks",
    method: "POST",
    pattern: new RegExp(`^/tasks/${ID}/result$`),
    kind: "ACTION",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `task:${m[1]}`,
    describe: () => "ارسال نتیجه‌ی وظیفه",
  },
  {
    key: "tasks.comment",
    label: "نظر روی وظیفه",
    module: "tasks",
    method: "POST",
    pattern: new RegExp(`^/tasks/${ID}/comments$`),
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `task:${m[1]}`,
    describe: () => "نظر روی وظیفه",
  },
  {
    key: "crm.contact.create",
    label: "مخاطب جدید",
    module: "crm",
    method: "POST",
    pattern: /^\/crm\/contacts$/,
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    creates: true,
    describe: (b) => `مخاطب جدید: ${str(rec(b).name)}`,
  },
  {
    key: "crm.contact.update",
    label: "ویرایش مخاطب",
    module: "crm",
    method: "PUT",
    pattern: new RegExp(`^/crm/contacts/${ID}$`),
    kind: "UPDATE",
    conflict: "stale",
    requiresOnline: false,
    entity: (m) => `contact:${m[1]}`,
    mergeFields: [
      { field: "name", label: "نام" },
      { field: "company", label: "شرکت" },
      { field: "phone", label: "موبایل" },
      { field: "email", label: "ایمیل" },
      { field: "address", label: "نشانی" },
    ],
    currentPath: (p) => p.split("?")[0],
    describe: (b) => `ویرایش مخاطب ${str(rec(b).name)}`.trim(),
  },
  {
    key: "crm.activity.add",
    label: "یادداشت/فعالیت مخاطب",
    module: "crm",
    method: "POST",
    pattern: new RegExp(`^/crm/contacts/${ID}/activities$`),
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `contact:${m[1]}`,
    describe: () => "یادداشت روی مخاطب",
  },
  {
    key: "reminders.create",
    label: "یادآور جدید",
    module: "dashboard",
    method: "POST",
    pattern: /^\/dashboard\/reminders$/,
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    creates: true,
    describe: (b) => `یادآور: ${str(rec(b).title)}`,
  },
  {
    key: "reminders.update",
    label: "ویرایش یادآور",
    module: "dashboard",
    method: "PATCH",
    pattern: new RegExp(`^/dashboard/reminders/${ID}$`),
    kind: "UPDATE",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `reminder:${m[1]}`,
    describe: (b) => `ویرایش یادآور ${str(rec(b).title)}`.trim(),
  },
  {
    key: "reminders.done",
    label: "انجام یادآور",
    module: "dashboard",
    method: "POST",
    pattern: new RegExp(`^/dashboard/reminders/${ID}/done$`),
    kind: "ACTION",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `reminder:${m[1]}`,
    describe: () => "انجام‌شدن یادآور",
  },
  {
    key: "sales.invoice.draft.create",
    label: "پیش‌نویس فاکتور",
    module: "sales",
    method: "POST",
    pattern: /^\/sales\/invoices$/,
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    // فاکتور رسمی شماره‌ی قانونی پشت‌سرهم می‌گیرد؛ آفلاین نمی‌شود
    when: (b) => !rec(b).isOfficial,
    creates: true,
    describe: () => "پیش‌نویس فاکتور فروش",
    optimisticNote: "پیش‌نویس آفلاین — شماره پس از همگام‌سازی",
  },
  {
    key: "sales.invoice.draft.update",
    label: "ویرایش پیش‌نویس فاکتور",
    module: "sales",
    method: "PUT",
    pattern: new RegExp(`^/sales/invoices/${ID}$`),
    kind: "UPDATE",
    conflict: "none",
    requiresOnline: false,
    when: (b) => !rec(b).isOfficial,
    entity: (m) => `invoice:${m[1]}`,
    describe: () => "ویرایش پیش‌نویس فاکتور",
  },
  {
    key: "sales.quotation.create",
    label: "پیش‌فاکتور",
    module: "sales",
    method: "POST",
    pattern: /^\/sales\/quotations$/,
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    creates: true,
    describe: () => "پیش‌فاکتور جدید",
    optimisticNote: "پیش‌نویس آفلاین — شماره پس از همگام‌سازی",
  },
  {
    key: "sales.quotation.update",
    label: "ویرایش پیش‌فاکتور",
    module: "sales",
    method: "PATCH",
    pattern: new RegExp(`^/sales/quotations/${ID}$`),
    kind: "UPDATE",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `quotation:${m[1]}`,
    describe: () => "ویرایش پیش‌فاکتور",
  },
  {
    key: "booking.appointment.create",
    label: "نوبت جدید",
    module: "booking",
    method: "POST",
    pattern: /^\/booking\/appointments$/,
    kind: "CREATE",
    conflict: "slot",
    requiresOnline: false,
    creates: true,
    describe: () => "ثبت نوبت",
    optimisticNote: "نوبت پس از همگام‌سازی نهایی می‌شود؛ ممکن است زمان پر شده باشد",
  },
  {
    key: "correspondence.incoming.register",
    label: "ثبت نامه‌ی وارده",
    module: "correspondence",
    method: "POST",
    pattern: /^\/correspondence\/letters\/incoming$/,
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    creates: true,
    describe: (b) => `نامه‌ی وارده: ${str(rec(b).subject)}`,
    optimisticNote: "ثبت‌شده آفلاین — شماره‌ی دبیرخانه پس از همگام‌سازی",
  },
  {
    key: "projects.note.add",
    label: "یادداشت پروژه",
    module: "projects",
    method: "POST",
    pattern: new RegExp(`^/projects/${ID}/notes$`),
    kind: "CREATE",
    conflict: "none",
    requiresOnline: false,
    entity: (m) => `project:${m[1]}`,
    describe: () => "یادداشت پروژه",
  },
];

export const OFFLINE_OP_KEYS: string[] = OFFLINE_OPS.map((o) => o.key);

export type OpMatch = { op: OfflineOp; m: RegExpExecArray; path: string };

/** مسیر را بدون کوئری و بدون پیشوند /api تطبیق می‌دهد. enabled = مجموعه‌ی کلیدهای مجاز سیاست (undefined = همه). */
export function matchOp(method: string, pathWithQuery: string, body: unknown, enabled?: ReadonlySet<string>): OpMatch | null {
  const path = pathWithQuery.split("?")[0].replace(/^\/api(?=\/)/, "").replace(/\/+$/, "") || "/";
  const meth = method.toUpperCase();
  for (const op of OFFLINE_OPS) {
    if (op.method !== meth) continue;
    const m = op.pattern.exec(path);
    if (!m) continue;
    if (op.when && !op.when(body)) continue;
    if (enabled && !enabled.has(op.key)) continue;
    return { op, m, path };
  }
  return null;
}

/** عملیات صریحاً آنلاین‌-تنها (UI دکمه را با «نیازمند اتصال» غیرفعال می‌کند). */
const ONLINE_ONLY: RegExp[] = [
  /\/sign(\/|$)/,
  /\/(approve|reject|confirm|void|cancel|reopen|revise)(\/|$)/,
  /\/payments?(\/|$)/,
  /\/(online-payment-link|send-payment-link|public-link)(\/|$)/,
  /^\/accounting\//,
  /^\/tax\//,
  /^\/(auth|licen[sc]e|licensing)\//,
  /^\/users\//,
  /^\/roles\b/,
  /\/permissions?(\/|$)/,
  /\/otp(\/|$)/,
  /^\/api-keys/,
  /^\/settings\//,
];

export function isOnlineOnly(method: string, path: string): boolean {
  if (method.toUpperCase() === "GET") return false;
  const p = path.split("?")[0].replace(/^\/api(?=\/)/, "");
  return ONLINE_ONLY.some((r) => r.test(p));
}

// ── خواندن‌های قابل‌کش ─────────────────────────────────────────────────────

export type ReadRule = {
  key: string;
  pattern: RegExp;
  /** response = کل پاسخ GET با کلید مسیر+کوئری ذخیره می‌شود؛ local-* = از فهرست‌های دلتا محلی پاسخ داده می‌شود */
  mode: "response" | "local-contacts" | "local-products";
  entity: string;
  ttlMs: number;
};

const MIN = 60_000;
export const READ_RULES: ReadRule[] = [
  { key: "checklist", pattern: /^\/daily-checklist$/, mode: "response", entity: "checklist", ttlMs: 5 * MIN },
  { key: "tasks", pattern: /^\/tasks$/, mode: "response", entity: "tasks", ttlMs: 5 * MIN },
  { key: "tasks-summary", pattern: /^\/tasks\/summary$/, mode: "response", entity: "tasks", ttlMs: 5 * MIN },
  { key: "users", pattern: /^\/users$/, mode: "response", entity: "users", ttlMs: 24 * 60 * MIN },
  { key: "reminders", pattern: /^\/dashboard\/reminders\/active$/, mode: "response", entity: "reminders", ttlMs: 5 * MIN },
  { key: "attendance", pattern: /^\/hr\/attendance$/, mode: "response", entity: "attendance", ttlMs: 10 * MIN },
  { key: "service-types", pattern: /^\/booking\/service-types$/, mode: "response", entity: "booking", ttlMs: 60 * MIN },
  { key: "contacts-search", pattern: /^\/crm\/contacts\/search$/, mode: "local-contacts", entity: "contacts", ttlMs: 6 * 60 * MIN },
  { key: "products", pattern: /^\/warehouse\/products$/, mode: "local-products", entity: "products", ttlMs: 6 * 60 * MIN },
];

export function matchReadRule(pathWithQuery: string): { rule: ReadRule; path: string; query: URLSearchParams } | null {
  const [rawPath, qs = ""] = pathWithQuery.split("?");
  const path = rawPath.replace(/^\/api(?=\/)/, "").replace(/\/+$/, "") || "/";
  for (const rule of READ_RULES) if (rule.pattern.test(path)) return { rule, path, query: new URLSearchParams(qs) };
  return null;
}

/** کلید کش پاسخ: مسیر + کوئری مرتب‌شده (شناسه‌ی کاربر/تننت در scope ذخیره‌گاه است). */
export function responseCacheKey(path: string, query: URLSearchParams): string {
  const entries = [...query.entries()].sort(([a], [b]) => a.localeCompare(b));
  const qs = new URLSearchParams(entries).toString();
  return `res:${path}${qs ? `?${qs}` : ""}`;
}

// ── جستجوی محلی روی فهرست‌های دلتا ────────────────────────────────────────

export type CachedContact = { id: string; name: string; company: string | null; phone: string | null; type: "INDIVIDUAL" | "COMPANY"; isCustomer: boolean; isSupplier: boolean; updatedAt: string };
export type CachedProduct = { id: string; sku: string; name: string; unit: string; category: string | null; salePrice: number; updatedAt: string };

const digitsFa = "۰۱۲۳۴۵۶۷۸۹";
const digitsAr = "٠١٢٣٤٥٦٧٨٩";
/** یکسان‌سازی ارقام فارسی/عربی و ی/ک عربی برای جستجو */
export function normalizeSearch(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(digitsFa.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(digitsAr.indexOf(d)))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .trim()
    .toLowerCase();
}

export function searchContactsLocal(rows: CachedContact[], query: URLSearchParams) {
  const q = normalizeSearch(query.get("q") ?? "");
  const limit = Math.min(Number(query.get("limit")) || 20, 50);
  const kind = query.get("kind");
  const out = [];
  for (const r of rows) {
    if (kind === "customer" && !r.isCustomer) continue;
    if (kind === "supplier" && !r.isSupplier) continue;
    if (q) {
      const hay = normalizeSearch(`${r.name} ${r.company ?? ""} ${r.phone ?? ""}`);
      if (!hay.includes(q)) continue;
    }
    out.push({ id: r.id, type: r.type, name: r.name, company: r.company, phone: r.phone, nationalId: null, isCustomer: r.isCustomer, isSupplier: r.isSupplier });
    if (out.length >= limit) break;
  }
  return out;
}

export function searchProductsLocal(rows: CachedProduct[], query: URLSearchParams) {
  const q = normalizeSearch(query.get("q") ?? "");
  return rows
    .filter((r) => !q || normalizeSearch(`${r.name} ${r.sku}`).includes(q))
    .slice(0, 200)
    .map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      category: r.category,
      costPrice: 0,
      salePrice: r.salePrice,
      reorderPoint: 0,
      isActive: true,
      createdAt: r.updatedAt,
      stock: 0,
      isLowStock: false,
      currencyId: null,
      costPriceFx: null,
      salePriceFx: null,
      _offlineStock: "unknown",
    }));
}
