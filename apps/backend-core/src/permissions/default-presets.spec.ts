import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_MODULE_PERMISSIONS } from '../tenants/default-tenant-data.seed.js';

/**
 * پیش‌فرض نقش‌های سیستمی: «حذف» فقط در نقش مدیر سیستم؛ هیچ نقش پایین‌تری بی‌صدا حق حذف نمی‌گیرد.
 * و هر ماژولِ پیش‌فرض باید در ماتریس دسترسی وب (قابل‌تنظیم) باشد.
 */
const DELETE_ALLOWED_ROLES = new Set(['مدیر سیستم']);
const WEB_API = resolve(__dirname, '../../../web-panel/src/lib/api.ts');

describe('default role presets', () => {
  it('only the system admin role gets canDelete by default', () => {
    const offenders: string[] = [];
    for (const [role, mods] of Object.entries(DEFAULT_MODULE_PERMISSIONS)) {
      if (DELETE_ALLOWED_ROLES.has(role)) continue;
      for (const [code, m] of Object.entries(mods)) if (m.canDelete) offenders.push(`${role}:${code}`);
    }
    expect(offenders).toEqual([]);
  });

  it('a "view own" only preset never allows edit/delete beyond create/edit of own records', () => {
    for (const [role, mods] of Object.entries(DEFAULT_MODULE_PERMISSIONS)) {
      for (const [code, m] of Object.entries(mods)) {
        if (m.canDelete) expect(m.canEdit, `${role}:${code}`).toBe(true); // حذف بدون ویرایش بی‌معناست
        if (m.canEdit || m.canDelete) expect(m.canViewAll || m.canViewOwn, `${role}:${code}`).toBe(true);
      }
    }
  });

  it('every preset module is offered in the web permission matrix', () => {
    const web = readFileSync(WEB_API, 'utf8');
    const block = /export const PERMISSION_GATED_MODULE_CODES = \[([\s\S]*?)\] as const/.exec(web)?.[1] ?? '';
    const gated = new Set([...block.matchAll(/"([a-z-]+)"/g)].map((x) => x[1]));
    const missing = new Set<string>();
    for (const mods of Object.values(DEFAULT_MODULE_PERMISSIONS)) for (const code of Object.keys(mods)) if (!gated.has(code)) missing.add(code);
    expect([...missing]).toEqual([]);
  });
});
