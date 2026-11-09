import { describe, expect, it } from 'vitest';
import { cooperationToMembershipStatus, levelToTier, planMembershipBackfill, tierToLevel, type LegacyProfileRow } from './agent-backfill.js';
import { isManualTransitionAllowed, stageAfterEvent } from './agent-funnel.js';
import { FUNNEL_STAGES } from './agent-constants.js';
import { InexactAmountError, UnsupportedCurrencyError, toBaseUnit, tomanToBase } from './agent-money.js';
import { normalizeIranMobile, phoneKey } from './agent-phone.js';
import { pickRule, resolveRates } from './agent-rules.js';
import { AGENT_WEB_PREFIXES, isAllowedForAgentSession } from './agent-session-policy.js';
import { classifyReminder, buildReminderMessage } from './agent-renewal-reminder.service.js';

describe('funnel transitions', () => {
  it('drives stages from events', () => {
    expect(stageAfterEvent(null, 'customer.registered')).toBe('REGISTERED');
    expect(stageAfterEvent('REGISTERED', 'customer.registered')).toBeNull();
    expect(stageAfterEvent('LOST', 'customer.registered')).toBe('REGISTERED');
    expect(stageAfterEvent('REGISTERED', 'subscription.activated', { isTrial: true })).toBe('TRIAL');
    expect(stageAfterEvent('TRIAL', 'subscription.activated')).toBe('PAID');
    expect(stageAfterEvent('PAID', 'subscription.activated')).toBeNull();
    expect(stageAfterEvent('PAID', 'subscription.renewed')).toBe('RENEWED');
    expect(stageAfterEvent('RENEWED', 'subscription.renewed')).toBeNull();
    expect(stageAfterEvent('RENEWED', 'subscription.cancelled')).toBe('LOST');
    expect(stageAfterEvent('LOST', 'subscription.cancelled')).toBeNull();
    expect(stageAfterEvent('PAID', 'payment.refunded')).toBeNull();
  });
  it('a trial never downgrades a paying customer', () => {
    expect(stageAfterEvent('PAID', 'subscription.activated', { isTrial: true })).toBeNull();
    expect(stageAfterEvent('RENEWED', 'subscription.activated', { isTrial: true })).toBeNull();
  });
  it('manual transitions: any valid different stage', () => {
    expect(isManualTransitionAllowed('PAID', 'LOST', FUNNEL_STAGES)).toBe(true);
    expect(isManualTransitionAllowed('PAID', 'PAID', FUNNEL_STAGES)).toBe(false);
    expect(isManualTransitionAllowed('PAID', 'WHATEVER', FUNNEL_STAGES)).toBe(false);
  });
});

describe('legacy → membership backfill (pure mirror of the SQL migration)', () => {
  const d = new Date('2026-01-01');
  const row = (o: Partial<LegacyProfileRow>): LegacyProfileRow => ({ id: 'p', productCode: 'ERP', tier: 'B', cooperationStatus: 'ACTIVE', createdAt: d, endedAt: null, endReason: null, ...o });
  it('maps tier and cooperation status', () => {
    expect(tierToLevel('A_PLUS')).toBe('A_PLUS');
    expect(tierToLevel('A')).toBe('A');
    expect(tierToLevel('B')).toBe('B');
    expect(tierToLevel('???')).toBe('B');
    expect(levelToTier('A_PLUS')).toBe('A_PLUS');
    expect(cooperationToMembershipStatus('END_REQUESTED')).toBe('ACTIVE');
    expect(cooperationToMembershipStatus('ENDED')).toBe('ENDED');
  });
  it('plans one membership per profile with a product; skips null productCode', () => {
    const plan = planMembershipBackfill([row({ id: '1', tier: 'A_PLUS' }), row({ id: '2', productCode: null }), row({ id: '3', productCode: 'REAL_ESTATE', cooperationStatus: 'ENDED', endedAt: d, endReason: 'x' })], []);
    expect(plan.products.sort()).toEqual(['ERP', 'REAL_ESTATE']);
    expect(plan.memberships).toHaveLength(2);
    expect(plan.memberships[0]).toMatchObject({ resellerProfileId: '1', level: 'A_PLUS', status: 'ACTIVE' });
    expect(plan.memberships[1]).toMatchObject({ status: 'ENDED', endReason: 'x' });
  });
  it('is idempotent: existing memberships are not re-planned', () => {
    const rows = [row({ id: '1' }), row({ id: '3', productCode: 'OTHER' })];
    const first = planMembershipBackfill(rows, []);
    const again = planMembershipBackfill(rows, first.memberships.map((m) => ({ resellerProfileId: m.resellerProfileId, productCode: m.productCode })));
    expect(again.memberships).toHaveLength(0);
  });
});

describe('versioned commission rules', () => {
  const rules = [
    { id: 'r1', level: 'A', firstPaymentPercent: 10, renewalPercent: 5, effectiveFrom: new Date('2026-01-01') },
    { id: 'r2', level: 'A', firstPaymentPercent: 12, renewalPercent: 6, effectiveFrom: new Date('2026-06-01') },
    { id: 'r3', level: 'B', firstPaymentPercent: 8, renewalPercent: 4, effectiveFrom: new Date('2026-01-01') },
  ];
  it('picks the latest rule effective at the event time (snapshot-by-date)', () => {
    expect(pickRule(rules, 'A', new Date('2026-03-01'))?.id).toBe('r1');
    expect(pickRule(rules, 'A', new Date('2026-07-01'))?.id).toBe('r2');
    expect(pickRule(rules, 'A', new Date('2025-12-31'))).toBeNull();
    expect(pickRule(rules, 'A_PLUS', new Date('2026-07-01'))).toBeNull();
  });
  it('falls back to legacy profile percents', () => {
    expect(resolveRates(rules, 'A', new Date('2026-07-01'), { first: 1, renewal: 1 })).toMatchObject({ firstPaymentPercent: 12, source: 'RULE', ruleId: 'r2' });
    expect(resolveRates(rules, 'A_PLUS', new Date('2026-07-01'), { first: 10, renewal: 5 })).toMatchObject({ firstPaymentPercent: 10, source: 'LEGACY_PROFILE', ruleId: null });
  });
});

describe('currency-aware amounts', () => {
  const toman = { code: 'IRT', tomanPerUnit: { num: 1n, den: 1n } };
  const rial = { code: 'IRR', tomanPerUnit: { num: 1n, den: 10n } };
  it('converts between IRT/IRR and the tenant base unit', () => {
    expect(toBaseUnit(500_000, 'IRT', toman)).toBe(500_000);
    expect(toBaseUnit(5_000_000, 'IRR', toman)).toBe(500_000);
    expect(toBaseUnit(500_000, 'IRT', rial)).toBe(5_000_000);
    expect(toBaseUnit(12_345, 'IRR', rial)).toBe(12_345); // ریال→ریال هیچ‌وقت ناصحیح نمی‌شود
    expect(toBaseUnit(1, 'irt', toman)).toBe(1);
  });
  it('rejects fractional results and unsupported currencies, never rounds silently', () => {
    expect(() => toBaseUnit(12_345, 'IRR', toman)).toThrow(InexactAmountError);
    expect(() => toBaseUnit(10, 'USD', toman)).toThrow(UnsupportedCurrencyError);
    expect(() => toBaseUnit(1.5, 'IRT', toman)).toThrow(InexactAmountError);
  });
  it('default min settlement (500,000 toman) follows the base unit', () => {
    expect(tomanToBase(500_000, toman)).toBe(500_000);
    expect(tomanToBase(500_000, rial)).toBe(5_000_000);
  });
});

describe('phones', () => {
  it('normalizes formats and compares by last 10 digits', () => {
    expect(normalizeIranMobile('+98 912 345 6789')).toBe('09123456789');
    expect(normalizeIranMobile('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(normalizeIranMobile('9123456789')).toBe('09123456789');
    expect(normalizeIranMobile('0098912345678')).toBeNull();
    expect(normalizeIranMobile('021123')).toBeNull();
    expect(phoneKey('09123456789')).toBe(phoneKey('+989123456789'));
  });
});

describe('agent session policy (server-side restricted role)', () => {
  it('allows agents / tasks / checklist / shell endpoints', () => {
    for (const [m, p] of [['GET', '/api/agents/me'], ['GET', '/api/agents/me/memberships/x/customers?stage=PAID'], ['POST', '/api/agents/me/change-request'], ['GET', '/api/tasks'], ['PATCH', '/api/tasks/abc'], ['GET', '/api/daily-checklist/today'], ['GET', '/api/me'], ['GET', '/api/modules'], ['GET', '/api/notifications/unread-count'], ['GET', '/api/license/status']]) {
      expect(isAllowedForAgentSession(m!, p!), `${m} ${p}`).toBe(true);
    }
  });
  it('blocks every other module and lookalike prefixes', () => {
    for (const p of ['/api/crm/contacts', '/api/sales/invoices', '/api/accounting/entries', '/api/hr/employees', '/api/users', '/api/roles', '/api/settings/api-keys', '/api/dashboard', '/api/dashboard/summary', '/api/dashboard/overdue-invoices/x/follow-ups', '/api/messengerx', '/api/referral-marketing/resellers', '/api/mentoring/sessions', '/api/meetings', '/api/tasksx', '/api/agents-api/v1/events', '/api/agentsfoo', '/api/billing/invoices', '/api/admin/tenants']) {
      expect(isAllowedForAgentSession('GET', p), p).toBe(false);
    }
  });
  it('allows the daily list, tasks & reminders, internal messenger and approvals inbox (and nothing else of the dashboard)', () => {
    for (const [m, p] of [['GET', '/api/dashboard/layout'], ['PUT', '/api/dashboard/layout/me'], ['GET', '/api/dashboard/calendar?year=1405&month=8'], ['GET', '/api/dashboard/reminders/active'], ['POST', '/api/dashboard/reminders/x/done'], ['GET', '/api/messenger/conversations'], ['POST', '/api/messenger/media'], ['GET', '/api/approvals'], ['POST', '/api/approvals/x/decide']]) {
      expect(isAllowedForAgentSession(m!, p!), `${m} ${p}`).toBe(true);
    }
    expect(isAllowedForAgentSession('PUT', '/api/dashboard/layout/company')).toBe(false);
    expect(isAllowedForAgentSession('GET', '/api/approvals/module-approvers')).toBe(false);
    expect(isAllowedForAgentSession('PUT', '/api/approvals/module-approvers/sales')).toBe(false);
    expect(AGENT_WEB_PREFIXES).toEqual(expect.arrayContaining(['/dashboard', '/messenger', '/approvals']));
  });
  it('is not fooled by traversal or double slashes', () => {
    expect(isAllowedForAgentSession('GET', '/api/tasks/../crm/contacts')).toBe(false);
    expect(isAllowedForAgentSession('GET', '/api/agents//../crm')).toBe(false);
  });
  it('web allow-list contains only the permitted pages', () => {
    expect(AGENT_WEB_PREFIXES).toContain('/agents');
    expect(AGENT_WEB_PREFIXES).not.toContain('/crm');
  });
});

describe('renewal reminders', () => {
  const now = new Date('2026-11-08T07:00:00Z');
  const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000);
  it('classifies D30 / D7 windows and ignores expired / far renewals', () => {
    expect(classifyReminder(inDays(30), now)).toBe('D30');
    expect(classifyReminder(inDays(8), now)).toBe('D30');
    expect(classifyReminder(inDays(7), now)).toBe('D7');
    expect(classifyReminder(inDays(1), now)).toBe('D7');
    expect(classifyReminder(inDays(0), now)).toBeNull();
    expect(classifyReminder(inDays(-3), now)).toBeNull();
    expect(classifyReminder(inDays(45), now)).toBeNull();
  });
  it('builds a capped message', () => {
    const msg = buildReminderMessage('D7', [{ name: 'الف', planName: 'پرو' }, { name: 'ب', planName: null }], 5, 'https://x/agents');
    expect(msg).toContain('الف (پرو)');
    expect(msg).toContain('و 5 مشتری دیگر');
    expect(msg).toContain('https://x/agents');
  });
});
