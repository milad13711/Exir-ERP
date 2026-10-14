import { describe, expect, it } from 'vitest';
import {
  buildDocsTaskText,
  defaultRuleDraft,
  docsComplete,
  evaluateRules,
  matchRule,
  missingDocTypes,
  normalizeText,
  type DocRule,
} from './dispatch-rules.js';
import { decideSourceAction, resolveStagesBeforeEnd, shouldSuggestForProduction } from './dispatch-suggestions.js';
import { canPerformStep, dispatchViewWhere, isExplicitlyAllowed } from './dispatch-scope.js';
import { mergeSettings } from './dispatch-settings.js';

const rule = (over: Partial<DocRule> = {}): DocRule => ({ id: 'r1', ...defaultRuleDraft('role-qc'), ...over });
const facts = (over = {}) => ({ netKg: 24000, cargoType: 'ذرت دانه‌ای', region: 'کرج', ...over });

describe('rules engine', () => {
  it('default rule triggers at >= 10,000 kg only', () => {
    expect(matchRule(rule(), facts({ netKg: 10000 }))).toBe(true);
    expect(matchRule(rule(), facts({ netKg: 9999.9 }))).toBe(false);
    expect(matchRule(rule(), facts({ netKg: null }))).toBe(false);
  });
  it('inactive rules never match', () => {
    expect(matchRule(rule({ isActive: false }), facts())).toBe(false);
  });
  it('cargo type and region conditions are ANDed with weight and matched loosely', () => {
    const r = rule({ minNetKg: null, cargoTypes: ['ذرت'], regions: ['كرج'] });
    expect(matchRule(r, facts())).toBe(true);
    expect(matchRule(r, facts({ cargoType: 'گندم' }))).toBe(false);
    expect(matchRule(r, facts({ region: 'تهران' }))).toBe(false);
    expect(matchRule(r, facts({ region: null }))).toBe(false);
  });
  it('a rule with no conditions matches everything', () => {
    expect(matchRule(rule({ minNetKg: null }), facts({ netKg: 1 }))).toBe(true);
  });
  it('evaluateRules unions docs and handlers across matched rules in priority order', () => {
    const ev = evaluateRules(
      [
        rule({ id: 'a', sortOrder: 2, docTypeCodes: ['QUARANTINE', 'OTHER'], handlerRoleId: null, handlerUserId: 'u9' }),
        rule({ id: 'b', sortOrder: 1 }),
        rule({ id: 'c', minNetKg: 99999 }),
      ],
      facts(),
    );
    expect(ev.matched.map((r) => r.id)).toEqual(['b', 'a']);
    expect(ev.requiredDocTypes).toEqual(['WAYBILL', 'QUARANTINE', 'OTHER']);
    expect(ev.handlerRoleIds).toEqual(['role-qc']);
    expect(ev.handlerUserIds).toEqual(['u9']);
  });
  it('doc gate helpers', () => {
    expect(missingDocTypes(['WAYBILL', 'QUARANTINE'], ['WAYBILL'])).toEqual(['QUARANTINE']);
    expect(docsComplete(['WAYBILL'], ['WAYBILL', 'OTHER'])).toBe(true);
    expect(docsComplete([], [])).toBe(true);
  });
  it('normalizes Arabic letters and ZWNJ', () => {
    expect(normalizeText(' كرج‌شهر ')).toBe('کرج شهر');
  });
  it('builds the waybill task text with customer and snapshot info', () => {
    const t = buildDocsTaskText({ shipmentNo: 12, customerName: 'شرکت الف', uniqueId: 'U1', nationalId: '0012345678', postalCode: '1234567890', postalAddress: 'تهران', netKg: 24450, cargoType: 'ذرت', docNames: ['بارنامه', 'برگ قرنطینه'] });
    expect(t.title).toBe('ثبت بارنامه و برگ قرنطینه — بار #12');
    expect(t.description).toContain('شرکت الف');
    expect(t.description).toContain('شناسه یکتا: U1');
    expect(t.description).toContain('کد پستی: 1234567890');
  });
});

describe('suggestions', () => {
  it('production trigger: 0 = last stage, 1 = second to last', () => {
    const f = (done: number, n: number, status = 'IN_PROGRESS') => shouldSuggestForProduction({ status, totalStages: 4, doneStages: done, stagesBeforeEnd: n });
    expect(f(2, 0)).toBe(false);
    expect(f(3, 0)).toBe(true);
    expect(f(2, 1)).toBe(true);
    expect(f(1, 1)).toBe(false);
    expect(f(0, 3)).toBe(true);
  });
  it('never suggests for draft/cancelled/rejected orders and handles orders without stages', () => {
    const base = { totalStages: 2, doneStages: 2, stagesBeforeEnd: 0 };
    for (const status of ['DRAFT', 'RAW_MATERIAL_APPROVED', 'CANCELLED', 'REJECTED']) expect(shouldSuggestForProduction({ ...base, status })).toBe(false);
    expect(shouldSuggestForProduction({ status: 'IN_PROGRESS', totalStages: 0, doneStages: 0, stagesBeforeEnd: 0 })).toBe(false);
    expect(shouldSuggestForProduction({ status: 'COMPLETED', totalStages: 0, doneStages: 0, stagesBeforeEnd: 0 })).toBe(true);
  });
  it('per-order override beats the tenant default; invalid values fall back to 0', () => {
    expect(resolveStagesBeforeEnd(2, 0)).toBe(2);
    expect(resolveStagesBeforeEnd(0, 3)).toBe(0);
    expect(resolveStagesBeforeEnd(null, 1)).toBe(1);
    expect(resolveStagesBeforeEnd(undefined, -4)).toBe(0);
  });
  it('dedupe: a live shipment for the same source blocks a second one; cancelled does not', () => {
    expect(decideSourceAction([])).toEqual({ action: 'CREATE' });
    expect(decideSourceAction([{ id: 's1', status: 'CANCELLED' }])).toEqual({ action: 'CREATE' });
    expect(decideSourceAction([{ id: 's1', status: 'CANCELLED' }, { id: 's2', status: 'LOADED' }])).toMatchObject({ action: 'EXISTS', shipment: { id: 's2' } });
  });
});

describe('scope & step access', () => {
  const user = { userId: 'u1', roleIds: ['qc'], manager: false };
  it('empty access means any editor; explicit lists restrict', () => {
    expect(canPerformStep({ roleIds: [], userIds: [] }, user)).toBe(true);
    expect(canPerformStep({ roleIds: ['qc'], userIds: [] }, user)).toBe(true);
    expect(canPerformStep({ roleIds: ['other'], userIds: [] }, user)).toBe(false);
    expect(canPerformStep({ roleIds: ['other'], userIds: ['u1'] }, user)).toBe(true);
    expect(canPerformStep({ roleIds: ['other'], userIds: [] }, { ...user, manager: true })).toBe(true);
  });
  it('explicit-only permissions deny by default', () => {
    expect(isExplicitlyAllowed({ roleIds: [], userIds: [] }, user)).toBe(false);
    expect(isExplicitlyAllowed(undefined, { ...user, manager: true })).toBe(true);
  });
  it('view scope: all, own, none (out-of-scope => caller answers 404)', () => {
    expect(dispatchViewWhere(true, true, 'u1', [])).toEqual({});
    expect(dispatchViewWhere(false, true, 'u1', ['s1'])).toEqual({
      OR: [{ createdByUserId: 'u1' }, { events: { some: { actorUserId: 'u1' } } }, { id: { in: ['s1'] } }],
    });
    expect(dispatchViewWhere(false, true, null, [])).toBeNull();
    expect(dispatchViewWhere(false, false, 'u1', [])).toBeNull();
  });
});

describe('settings merge', () => {
  it('fills defaults and sanitizes junk', () => {
    const s = mergeSettings({ productionTrigger: { stagesBeforeEnd: 99 }, receipt: { requiredBefore: 'bogus' }, steps: { cleanliness: { roleIds: ['a', 5] } } });
    expect(s.productionTrigger.stagesBeforeEnd).toBe(0);
    expect(s.receipt.requiredBefore).toBe('DEPARTURE');
    expect(s.steps.cleanliness.roleIds).toEqual(['a']);
    expect(mergeSettings(null).productionTrigger.enabled).toBe(true);
  });
});
