import {
  ACKNOWLEDGED_HISTORICAL,
  HISTORICAL_KEYS,
  PERSONAL,
  TRANSFERABLE,
  delegateName,
  splitKey,
  type PersonalEntry,
  type TransferEntry,
} from './ownership-registry.js';

/**
 * موتور انتقال: روی یک کلاینت Prisma تننت (یا tx تراکنش تعاملی) کار می‌کند. همه‌ی نوشتن‌ها فقط وقتی انجام می‌شود که
 * dryRun=false؛ با dryRun همان خواندن‌ها اجرا و همان شمارش‌ها برگردانده می‌شود (تضمین «dry-run برابر اجرای واقعی»).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export const UNASSIGN = Symbol('unassign');
export type TargetFor = (entry: TransferEntry) => string | typeof UNASSIGN;

export type EntryResult = { key: string; moduleCode: string; label: string; moved: number; merged: number; unassigned: number };
export type DetailRow = { key: string; action: 'moved' | 'merged' | 'unassigned'; toUserId: string | null; ids: string[] };
export type CleanupResult = { key: string; label: string; action: 'delete' | 'nullify'; count: number };
export type OffboardingMode = 'transfer-only' | 'deactivate' | 'delete';

const CHUNK = 2000;
/** شناسه‌های آرایه‌ای که کلید آن‌ها در رجیستری A نیست ولی در شمارش مراجع باقی‌مانده باید دیده شوند. */
const ARRAY_REF_FIELDS: Record<string, { table: string; column: string }> = {
  'MessengerMessage.mentionIds': { table: 'messenger_messages', column: 'mentionIds' },
};

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function assertSafeIdent(s: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`شناسه‌ی نامعتبر SQL: ${s}`);
  return s;
}

/** شمارش رکوردهای مالکیتی او به‌تفکیک ورودی رجیستری (برای پیش‌نمایش). */
export async function countOwned(db: Db, fromUserId: string, now: Date): Promise<Array<{ entry: TransferEntry; count: number }>> {
  const out: Array<{ entry: TransferEntry; count: number }> = [];
  for (const entry of TRANSFERABLE) {
    if (entry.kind === 'array') {
      const t = assertSafeIdent(entry.table!);
      const c = assertSafeIdent(entry.column!);
      const rows = (await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}" WHERE $1 = ANY("${c}")`, fromUserId)) as Array<{ n: number }>;
      out.push({ entry, count: rows[0]?.n ?? 0 });
      continue;
    }
    const count = await db[delegateName(entry.model)].count({ where: { [entry.field]: fromUserId, ...entry.scope?.(now) } });
    out.push({ entry, count });
  }
  return out;
}

export type TransferOutcome = { entries: EntryResult[]; details: DetailRow[] };

export async function transferOwnership(
  db: Db,
  p: { fromUserId: string; targetFor: TargetFor; now: Date; dryRun: boolean },
): Promise<TransferOutcome> {
  const entries: EntryResult[] = [];
  const details: DetailRow[] = [];
  for (const entry of TRANSFERABLE) {
    const res: EntryResult = { key: entry.key, moduleCode: entry.moduleCode, label: entry.label, moved: 0, merged: 0, unassigned: 0 };

    if (entry.kind === 'array') {
      await transferArray(db, entry, p.fromUserId, () => p.targetFor(entry), p.dryRun, res);
      if (res.moved || res.unassigned) entries.push(res);
      continue;
    }

    const delegate = db[delegateName(entry.model)];
    const idField = entry.idField ?? 'id';
    const select: Record<string, boolean> = { [idField]: true };
    if (entry.kind === 'assignee-join') select[entry.parentField!] = true;
    const rows: Array<Record<string, string>> = await delegate.findMany({
      where: { [entry.field]: p.fromUserId, ...entry.scope?.(p.now) },
      select,
    });
    if (rows.length === 0) continue;
    const target = p.targetFor(entry);

    if (target === UNASSIGN) {
      const ids = rows.map((r) => r[idField]);
      if (!p.dryRun) {
        for (const part of chunks(ids)) {
          const where = { [idField]: { in: part }, [entry.field]: p.fromUserId };
          if (entry.managerOnly?.fallback === 'delete') await delegate.deleteMany({ where });
          else await delegate.updateMany({ where, data: { [entry.field]: null } });
        }
      }
      res.unassigned = ids.length;
      details.push({ key: entry.key, action: 'unassigned', toUserId: null, ids });
      entries.push(res);
      continue;
    }

    let moveIds = rows.map((r) => r[idField]);
    if (entry.kind === 'assignee-join') {
      // مقصد همین انتساب را دارد → ردیف خروجی ادغام (حذف) می‌شود تا unique نشکند.
      const parents = [...new Set(rows.map((r) => r[entry.parentField!]))];
      const taken = new Set<string>();
      for (const part of chunks(parents)) {
        const existing: Array<Record<string, string>> = await delegate.findMany({
          where: { [entry.field]: target, [entry.parentField!]: { in: part } },
          select: { [entry.parentField!]: true },
        });
        for (const e of existing) taken.add(e[entry.parentField!]);
      }
      const mergeIds = rows.filter((r) => taken.has(r[entry.parentField!])).map((r) => r[idField]);
      moveIds = rows.filter((r) => !taken.has(r[entry.parentField!])).map((r) => r[idField]);
      if (!p.dryRun) for (const part of chunks(mergeIds)) await delegate.deleteMany({ where: { [idField]: { in: part }, [entry.field]: p.fromUserId } });
      res.merged = mergeIds.length;
      if (mergeIds.length) details.push({ key: entry.key, action: 'merged', toUserId: target, ids: mergeIds });
    }

    if (!p.dryRun) {
      let done = 0;
      for (const part of chunks(moveIds)) {
        const r = await delegate.updateMany({ where: { [idField]: { in: part }, [entry.field]: p.fromUserId }, data: { [entry.field]: target } });
        done += typeof r?.count === 'number' ? r.count : part.length;
      }
      res.moved = done;
      if (entry.afterMove === 'corr-referral-participant') {
        // مقصد باید نامه‌ی ارجاع‌شده را ببیند: مشارکت‌کننده‌ی REFERRAL می‌سازیم
        const refs: Array<{ letterId: string }> = await db.corrReferral.findMany({ where: { id: { in: moveIds } }, select: { letterId: true } });
        const data = [...new Set(refs.map((x) => x.letterId))].map((letterId) => ({ letterId, userId: target, role: 'REFERRAL' }));
        if (data.length) await db.corrParticipant.createMany({ data, skipDuplicates: true });
      }
    } else {
      res.moved = moveIds.length;
    }
    if (moveIds.length) details.push({ key: entry.key, action: 'moved', toUserId: target, ids: moveIds });
    if (res.moved || res.merged) entries.push(res);
  }
  return { entries, details };
}

async function transferArray(db: Db, entry: TransferEntry, from: string, targetOf: () => string | typeof UNASSIGN, dryRun: boolean, res: EntryResult): Promise<void> {
  const t = assertSafeIdent(entry.table!);
  const c = assertSafeIdent(entry.column!);
  const rows = (await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${t}" WHERE $1 = ANY("${c}")`, from)) as Array<{ n: number }>;
  const n = rows[0]?.n ?? 0;
  if (n === 0) return;
  const target = targetOf();
  if (target === UNASSIGN) {
    if (!dryRun) await db.$executeRawUnsafe(`UPDATE "${t}" SET "${c}" = array_remove("${c}", $1) WHERE $1 = ANY("${c}")`, from);
    res.unassigned = n;
    return;
  }
  if (!dryRun) {
    // جایگزینی عنصر + حذف تکرار (اگر مقصد از قبل در آرایه بود) با حفظ ترتیب اولین رخداد.
    await db.$executeRawUnsafe(
      `UPDATE "${t}" SET "${c}" = ARRAY(SELECT x FROM (SELECT x, min(ord) AS o FROM unnest(array_replace("${c}", $1, $2)) WITH ORDINALITY AS u(x, ord) GROUP BY x) s ORDER BY o) WHERE $1 = ANY("${c}")`,
      from,
      target,
    );
  }
  res.moved = n;
}

function cleanupRulesFor(mode: OffboardingMode, entry: PersonalEntry) {
  return entry.cleanup.filter((r) => r.when === 'always' || (r.when === 'delete-mode' && mode === 'delete'));
}

/** پاک‌سازی داده‌ی شخصی/دسترسی (C). در حالت transfer-only هیچ کاری نمی‌کند. */
export async function cleanupPersonal(db: Db, p: { userId: string; mode: OffboardingMode; dryRun: boolean }): Promise<CleanupResult[]> {
  if (p.mode === 'transfer-only') return [];
  const out: CleanupResult[] = [];
  for (const entry of PERSONAL) {
    const delegate = db[delegateName(entry.model)];
    let delCount = 0;
    let nullCount = 0;
    for (const rule of cleanupRulesFor(p.mode, entry)) {
      const where = { [entry.field]: p.userId, ...rule.where };
      const count = await delegate.count({ where });
      if (count === 0) continue;
      if (!p.dryRun) {
        if (rule.action === 'delete') await delegate.deleteMany({ where });
        else await delegate.updateMany({ where, data: { [entry.field]: null } });
      }
      if (rule.action === 'delete') delCount += count;
      else nullCount += count;
    }
    if (delCount) out.push({ key: entry.key, label: entry.label, action: 'delete', count: delCount });
    if (nullCount) out.push({ key: entry.key, label: entry.label, action: 'nullify', count: nullCount });
  }
  return out;
}

/**
 * آیا هنوز هر ارجاعی (تاریخچه/لاگ/…) به این کاربر مانده؟ اگر بله، «حذف کامل» به‌صورت ناشناس‌سازی انجام می‌شود
 * نه حذف ردیف (تا SetNull/Restrict سابقه را خراب نکند). اولین مورد پیدا شد متوقف می‌شود.
 */
export async function hasRemainingReferences(db: Db, userId: string): Promise<boolean> {
  const keys = [...Object.keys(ACKNOWLEDGED_HISTORICAL), ...HISTORICAL_KEYS, ...TRANSFERABLE.map((e) => e.key), ...PERSONAL.map((e) => e.key)];
  for (const key of keys) {
    const arr = ARRAY_REF_FIELDS[key];
    if (arr) {
      const rows = (await db.$queryRawUnsafe(`SELECT 1 AS n FROM "${assertSafeIdent(arr.table)}" WHERE $1 = ANY("${assertSafeIdent(arr.column)}") LIMIT 1`, userId)) as unknown[];
      if (rows.length > 0) return true;
      continue;
    }
    const { model, field } = splitKey(key);
    // ownerKey/… فقط رشته‌ی برابر با شناسه است؛ بقیه FK یا شناسه‌ی ساده‌اند
    const hit = await db[delegateName(model)].findFirst({ where: { [field]: userId }, select: { [field]: true } });
    if (hit) return true;
  }
  return false;
}
