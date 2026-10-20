import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACKNOWLEDGED_HISTORICAL, HISTORICAL_KEYS, MATRIX_GATED_MODULE_CODES, MODULE_LABELS, PERSONAL, TRANSFERABLE, allRegisteredKeys, splitKey } from './ownership-registry.js';
import { findUserReferencingFields, parseSchemaModels } from './schema-user-refs.js';

const SCHEMA = readFileSync(resolve(__dirname, '../../../prisma/tenant/schema.prisma'), 'utf8');
const WEB_API = resolve(__dirname, '../../../../web-panel/src/lib/api.ts');

describe('ownership registry vs prisma/tenant/schema.prisma', () => {
  const detected = findUserReferencingFields(SCHEMA);
  const registered = new Set(allRegisteredKeys());

  it('detects a sane number of User-referencing fields (parser guard)', () => {
    expect(detected.length).toBeGreaterThan(100);
    expect(detected).toContain('CrmContact.ownerUserId');
    expect(detected).toContain('MessengerMessage.senderId');
  });

  it('every User-referencing field is registered (A/B/C) or acknowledged — a new model cannot be forgotten', () => {
    const missing = detected.filter((k) => !registered.has(k));
    expect(missing, `فیلدهای زیر به User اشاره می‌کنند ولی در src/users/offboarding/ownership-registry.ts ثبت نشده‌اند (A: TRANSFERABLE، B: HISTORICAL، C: PERSONAL یا ACKNOWLEDGED_HISTORICAL):\n${missing.join('\n')}`).toEqual([]);
  });

  it('has no duplicate keys across the A/B/C/acknowledged lists', () => {
    const all = allRegisteredKeys();
    const dupes = all.filter((k, i) => all.indexOf(k) !== i);
    expect(dupes).toEqual([]);
  });

  it('every registered key exists in the schema (no stale entries) and entries are consistent', () => {
    const models = parseSchemaModels(SCHEMA);
    for (const key of allRegisteredKeys()) {
      const { model, field } = splitKey(key);
      const fields = models.get(model);
      expect(fields, `مدل ${model} در schema نیست (${key})`).toBeDefined();
      expect(fields!.some((f) => f.field === field), `فیلد ${key} در schema نیست`).toBe(true);
    }
    for (const e of TRANSFERABLE) {
      expect(e.key).toBe(`${e.model}.${e.field}`);
      expect(MODULE_LABELS[e.moduleCode], `برچسب فارسی ماژول ${e.moduleCode}`).toBeTruthy();
      if (e.kind === 'assignee-join') {
        expect(e.parentField, e.key).toBeTruthy();
        expect(models.get(e.model)!.some((f) => f.field === e.parentField), `${e.key} parentField`).toBe(true);
        expect(SCHEMA).toMatch(new RegExp(`model ${e.model} \\{[\\s\\S]*?@@unique\\(\\[(?:${e.parentField}, ${e.field}|${e.field}, ${e.parentField})\\]\\)`));
      }
      if (e.kind === 'array') expect(e.table && e.column, e.key).toBeTruthy();
      expect(e.scopeNote.length).toBeGreaterThan(5);
    }
    for (const p of PERSONAL) {
      expect(p.key).toBe(`${p.model}.${p.field}`);
      expect(p.cleanup.length, p.key).toBeGreaterThan(0);
    }
  });

  it('A/C keys do not overlap with historical keys', () => {
    const hist = new Set([...HISTORICAL_KEYS, ...Object.keys(ACKNOWLEDGED_HISTORICAL)]);
    for (const e of [...TRANSFERABLE, ...PERSONAL]) expect(hist.has(e.key), e.key).toBe(false);
  });

  it('keeps MATRIX_GATED_MODULE_CODES identical to the web-panel permission matrix list', () => {
    const web = readFileSync(WEB_API, 'utf8');
    const m = /export const PERMISSION_GATED_MODULE_CODES = \[([\s\S]*?)\] as const/.exec(web);
    expect(m).not.toBeNull();
    const webCodes = [...m![1].matchAll(/"([a-z-]+)"/g)].map((x) => x[1]).sort();
    expect([...MATRIX_GATED_MODULE_CODES].sort()).toEqual(webCodes);
  });

  it('the schema parser itself flags an unregistered User reference (self-test of the guard)', () => {
    const fake = `model Fake {\n  id String @id\n  ownerUserId String?\n  owner User? @relation(fields: [ownerUserId], references: [id])\n  reviewedByUserId String?\n}\n`;
    const found = findUserReferencingFields(fake);
    expect(found).toEqual(['Fake.ownerUserId', 'Fake.reviewedByUserId']);
    expect(found.filter((k) => !registered.has(k))).toHaveLength(2);
  });
});
