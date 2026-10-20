/**
 * تحلیل متنی schema.prisma تننت برای یافتن همه‌ی فیلدهایی که به User اشاره می‌کنند (هم رابطه‌ی Prisma و هم
 * شناسه‌ی کاربر بدون FK مثل Task.createdByUserId یا MessengerMessage.senderId).
 *
 * فقط برای تست «کامل‌بودن رجیستری» استفاده می‌شود (ownership-registry.spec.ts) — هیچ import ای از prisma/ندارد
 * و در زمان اجرا خوانده نمی‌شود.
 */

export type SchemaField = { model: string; field: string; type: string; optional: boolean; list: boolean; attrs: string };

/** نام‌هایی که به User اشاره می‌کنند ولی الگوی *UserId ندارند (پیام‌رسان). */
export const EXTRA_USER_FIELD_NAMES = ['senderId', 'uploaderId', 'createdById', 'pinnedById', 'mentionIds'];

export function parseSchemaModels(schemaText: string): Map<string, SchemaField[]> {
  const models = new Map<string, SchemaField[]>();
  let cur: SchemaField[] | null = null;
  let curName = '';
  for (const raw of schemaText.split('\n')) {
    const mm = /^model (\w+) \{/.exec(raw);
    if (mm) {
      curName = mm[1];
      cur = [];
      models.set(curName, cur);
      continue;
    }
    if (raw.startsWith('}')) {
      cur = null;
      continue;
    }
    if (!cur) continue;
    const fm = /^\s+(\w+)\s+(\w+)(\?|\[\])?\s*(.*)$/.exec(raw);
    if (!fm || raw.trim().startsWith('//') || raw.trim().startsWith('@@')) continue;
    cur.push({ model: curName, field: fm[1], type: fm[2], optional: fm[3] === '?', list: fm[3] === '[]', attrs: fm[4] });
  }
  return models;
}

/** کلیدهای «Model.field» همه‌ی فیلدهای اسکالر مدل‌های غیر-User که به User ارجاع می‌دهند. */
export function findUserReferencingFields(schemaText: string): string[] {
  const models = parseSchemaModels(schemaText);
  const out = new Set<string>();
  for (const [model, fields] of models) {
    if (model === 'User') continue;
    for (const f of fields) {
      if (f.type === 'User') {
        const rel = /fields:\s*\[([^\]]+)\]/.exec(f.attrs);
        if (rel) for (const fk of rel[1].split(',')) out.add(`${model}.${fk.trim()}`);
        continue;
      }
      if (f.type !== 'String') continue;
      if (/UserIds?$/.test(f.field) || f.field === 'userId' || EXTRA_USER_FIELD_NAMES.includes(f.field)) out.add(`${model}.${f.field}`);
    }
  }
  return [...out].sort();
}
