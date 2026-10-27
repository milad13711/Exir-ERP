/** منطق خالص دریافت دلتا (ورودی‌ها و محدودیت‌ها) — بدون Prisma تا آزمون‌پذیر باشد. */
export const CHANGE_ENTITIES = ['contacts', 'products', 'tasksMine', 'users'] as const;
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number];

export const DEFAULT_LIMIT = 500;
export const MAX_LIMIT = 2000;

/** کرسر ترکیبی (updatedAt, id): ردیف‌های هم‌میلی‌ثانیه گم نمی‌شوند. قالب رشته: `ISO` یا `ISO|id`. */
export type Cursor = { at: Date; id: string | null };
export type ChangesQuery = { entities: ChangeEntity[]; since: Cursor | null; limit: number; withIds: boolean };

/** سقف پرس‌وجوی فهرست شناسه‌ها (withIds)؛ بیشتر از این → ids ارسال نمی‌شود و کلاینت هرس نمی‌کند. */
export const MAX_IDS = 5000;

export function parseCursor(raw: unknown): Cursor | null {
  if (typeof raw !== 'string' || raw.length > 90) return null;
  const [iso, id] = raw.split('|');
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return { at: new Date(t), id: id && /^[0-9a-zA-Z_-]{1,64}$/.test(id) ? id : null };
}

export const formatCursor = (at: Date, id: string) => `${at.toISOString()}|${id}`;

/** where برای Prisma: (updatedAt > t) یا (updatedAt = t و id > cursorId) — به‌همراه orderBy [{updatedAt:'asc'},{id:'asc'}] */
export function cursorWhere(since: Cursor | null): Record<string, unknown> {
  if (!since) return {};
  if (!since.id) return { updatedAt: { gt: since.at } };
  return { OR: [{ updatedAt: { gt: since.at } }, { updatedAt: since.at, id: { gt: since.id } }] };
}

export function parseChangesQuery(q: { entities?: unknown; since?: unknown; limit?: unknown; withIds?: unknown }): ChangesQuery {
  const rawEntities = typeof q.entities === 'string' ? q.entities.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const set = new Set<ChangeEntity>();
  for (const e of rawEntities) if ((CHANGE_ENTITIES as readonly string[]).includes(e)) set.add(e as ChangeEntity);
  const since = parseCursor(q.since);
  const lim = Number(q.limit);
  const limit = Number.isFinite(lim) && lim > 0 ? Math.min(Math.floor(lim), MAX_LIMIT) : DEFAULT_LIMIT;
  return { entities: [...set].slice(0, 4), since, limit, withIds: q.withIds === '1' || q.withIds === 'true' };
}

export type ChangesResult<T extends { updatedAt: Date }> = {
  mode: 'full' | 'delta';
  items: Array<Omit<T, 'updatedAt'> & { updatedAt: string }>;
  /** مقدار since بعدی؛ اگر truncated باشد کلاینت دوباره از همین نقطه می‌پرسد. */
  nextSince: string | null;
  truncated: boolean;
  ids?: string[];
};

/** ردیف‌های مرتب‌شده‌ی صعودی بر updatedAt را به پاسخ تبدیل می‌کند. rows باید limit+1 باشد تا truncated تشخیص داده شود. */
export function buildChangesResult<T extends { id: string; updatedAt: Date }>(rows: T[], q: ChangesQuery, ids?: string[]): ChangesResult<T> {
  const truncated = rows.length > q.limit;
  const page = truncated ? rows.slice(0, q.limit) : rows;
  const last = page[page.length - 1];
  return {
    mode: q.since ? 'delta' : 'full',
    items: page.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
    nextSince: last ? formatCursor(last.updatedAt, last.id) : q.since ? (q.since.id ? formatCursor(q.since.at, q.since.id) : q.since.at.toISOString()) : null,
    truncated,
    ...(ids ? { ids } : {}),
  };
}
