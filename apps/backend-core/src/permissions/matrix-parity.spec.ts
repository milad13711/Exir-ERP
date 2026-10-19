import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Parity guard: every module code that backend code gates through PermissionsService
 * (assertView/Create/Edit/Delete/getEffective ...) must be offered in the web role/user
 * permission matrix (PERMISSION_GATED_MODULE_CODES in apps/web-panel/src/lib/api.ts) —
 * otherwise an admin can never grant it to a non-manager role. Codes deliberately not
 * matrix-gated are listed in PERMISSION_MATRIX_EXEMPT_MODULE_CODES.
 */
const SRC = resolve(__dirname, '..');
const WEB_API = resolve(__dirname, '../../../web-panel/src/lib/api.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function parseList(src: string, name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(src);
  if (!m) throw new Error(`${name} not found in web api.ts`);
  return [...m[1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]);
}

describe('permission matrix parity (web list vs backend gates)', () => {
  const web = readFileSync(WEB_API, 'utf8');
  const gated = new Set(parseList(web, 'PERMISSION_GATED_MODULE_CODES'));
  const exempt = new Set(parseList(web, 'PERMISSION_MATRIX_EXEMPT_MODULE_CODES'));

  const used = new Set<string>();
  const re = /(?:assert(?:View|ViewAll|Create|Edit|Delete)|getEffective)\(\s*[A-Za-z_.]+\s*,\s*'([a-z-]+)'/g;
  for (const f of walk(SRC)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(re)) used.add(m[1]);
  }

  it('finds the backend-gated modules (sanity)', () => {
    expect(used.size).toBeGreaterThan(15);
    expect(used.has('sales')).toBe(true);
  });

  it('every backend-gated module is in the web matrix list', () => {
    const missing = [...used].filter((c) => !gated.has(c));
    expect(missing).toEqual([]);
  });

  it('exempt codes are not simultaneously matrix-gated', () => {
    expect([...exempt].filter((c) => gated.has(c))).toEqual([]);
  });
});
