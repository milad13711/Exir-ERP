import { describe, expect, it } from 'vitest';
import { commissionAmount, deriveOccurrence, netFrom, pickPlanRule, reversalAmount, walletBalances, type PlanRuleLike } from './agent-commission.js';

const T0 = new Date('2026-11-01T00:00:00Z');
const T1 = new Date('2026-11-10T00:00:00Z');
const NOW = new Date('2026-11-05T00:00:00Z');

function rule(p: Partial<PlanRuleLike> & { id: string; percent: number }): PlanRuleLike {
  return { level: 'A', txTypeCode: null, itemCode: null, occurrence: 'ANY', effectiveFrom: T0, endedAt: null, ...p };
}

describe('pickPlanRule — the example from the spec (silver/A, Exir Amlak, CRM: 10% first, 15% each renewal)', () => {
  const rules = [
    rule({ id: 'crm-first', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', occurrence: 'FIRST', percent: 10 }),
    rule({ id: 'crm-renew', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', occurrence: 'RENEWAL', percent: 15 }),
    rule({ id: 'any-sub', txTypeCode: 'SUBSCRIPTION', percent: 5 }),
    rule({ id: 'fallback', percent: 2 }),
    rule({ id: 'other-level', level: 'B', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', occurrence: 'FIRST', percent: 50 }),
  ];
  const facts = { level: 'A', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', at: NOW };

  it('first CRM purchase → 10%, renewal → 15%', () => {
    expect(pickPlanRule(rules, { ...facts, occurrence: 'FIRST' })?.id).toBe('crm-first');
    expect(pickPlanRule(rules, { ...facts, occurrence: 'RENEWAL' })?.id).toBe('crm-renew');
  });

  it('falls back to the most specific matching rule, never another level', () => {
    expect(pickPlanRule(rules, { ...facts, itemCode: 'hr', occurrence: 'FIRST' })?.id).toBe('any-sub');
    expect(pickPlanRule(rules, { ...facts, txTypeCode: 'SMS_PACKAGE', itemCode: null, occurrence: 'ONE_OFF' })?.id).toBe('fallback');
    expect(pickPlanRule(rules, { ...facts, level: 'A_PLUS', occurrence: 'FIRST' })).toBeNull();
  });

  it('a refund never picks a rule (reversal is derived from the original commission)', () => {
    expect(pickPlanRule(rules, { ...facts, occurrence: 'REFUND' })).toBeNull();
  });
});

describe('pickPlanRule — versioning (a change applies only to transactions after it)', () => {
  const old = rule({ id: 'v1', txTypeCode: 'SUBSCRIPTION', occurrence: 'RENEWAL', percent: 15, endedAt: T1 });
  const next = rule({ id: 'v2', txTypeCode: 'SUBSCRIPTION', occurrence: 'RENEWAL', percent: 12, effectiveFrom: T1 });
  const f = { level: 'A', txTypeCode: 'SUBSCRIPTION', itemCode: 'crm', occurrence: 'RENEWAL' as const };

  it('before the change the old rate applies, from the change on the new one', () => {
    expect(pickPlanRule([old, next], { ...f, at: NOW })?.id).toBe('v1');
    expect(pickPlanRule([old, next], { ...f, at: T1 })?.id).toBe('v2');
  });

  it('a not-yet-effective (scheduled) rule is ignored; an ended rule is ignored', () => {
    expect(pickPlanRule([next], { ...f, at: NOW })).toBeNull();
    expect(pickPlanRule([old], { ...f, at: new Date('2026-12-01T00:00:00Z') })).toBeNull();
  });
});

describe('amounts', () => {
  it('commission is floor(net × percent) with exact integer math', () => {
    expect(commissionAmount(8_000_000, 10)).toBe(800_000);
    expect(commissionAmount(8_000_000, 15)).toBe(1_200_000);
    expect(commissionAmount(999, 12.5)).toBe(124); // 124.875 → 124
    expect(commissionAmount(1_000_000, 0.01)).toBe(100);
    expect(commissionAmount(0, 10)).toBe(0);
    expect(commissionAmount(1000, 0)).toBe(0);
  });

  it('net = gross − discount when net is not sent; tax is never part of the base', () => {
    expect(netFrom({ grossAmount: 10_000_000, discountAmount: 2_000_000 })).toBe(8_000_000);
    expect(netFrom({ netAmount: 7_500_000, grossAmount: 10_000_000 })).toBe(7_500_000);
    expect(netFrom({})).toBeNull();
  });

  it('first vs renewal is derived from history unless the product says so', () => {
    expect(deriveOccurrence(null, 0)).toBe('FIRST');
    expect(deriveOccurrence(null, 3)).toBe('RENEWAL');
    expect(deriveOccurrence('ONE_OFF', 3)).toBe('ONE_OFF');
  });

  it('refund reversal is proportional and never exceeds what is left', () => {
    expect(reversalAmount(800_000, 0, 8_000_000, 8_000_000)).toBe(800_000);
    expect(reversalAmount(800_000, 0, 8_000_000, 2_000_000)).toBe(200_000);
    expect(reversalAmount(800_000, 700_000, 8_000_000, 2_000_000)).toBe(100_000);
    expect(reversalAmount(0, 0, 8_000_000, 2_000_000)).toBe(0);
  });

  it('wallet: held until the hold period passes; reversals reduce the available balance at once', () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    const past = new Date(NOW.getTime() - 86_400_000);
    expect(walletBalances([{ amount: 800_000, availableAt: past }, { amount: 1_200_000, availableAt: future }, { amount: -200_000, availableAt: future }], NOW)).toEqual({
      available: 600_000,
      held: 1_200_000,
      total: 1_800_000,
    });
  });
});

import { canTransitionPayout, payoutRejection, referralUrl, walletSummary } from './agent-commission.js';

describe('payouts', () => {
  const past = new Date(NOW.getTime() - 86_400_000);
  const future = new Date(NOW.getTime() + 86_400_000);

  it('wallet summary: open requests reserve, paid is final, rejected/cancelled release', () => {
    const s = walletSummary(
      [{ amount: 2_000_000, availableAt: past }, { amount: 500_000, availableAt: future }, { amount: -100_000, availableAt: future }],
      [{ amount: 600_000, status: 'PAID' }, { amount: 400_000, status: 'REQUESTED' }, { amount: 900_000, status: 'REJECTED' }, { amount: 50_000, status: 'CANCELLED' }],
      NOW,
    );
    expect(s).toEqual({ earnedAvailable: 1_900_000, held: 500_000, totalEarned: 2_400_000, pending: 400_000, paid: 600_000, withdrawable: 900_000 });
  });

  it('a reversal after payout can make the withdrawable balance negative', () => {
    expect(walletSummary([{ amount: 1_000_000, availableAt: past }, { amount: -400_000, availableAt: past }], [{ amount: 1_000_000, status: 'PAID' }], NOW).withdrawable).toBe(-400_000);
  });

  const ok = { amount: 600_000, withdrawable: 900_000, minAmount: 500_000, membershipStatus: 'ACTIVE', hasOpenPayout: false, shebaVerified: true };
  it('request validation', () => {
    expect(payoutRejection(ok)).toBeNull();
    expect(payoutRejection({ ...ok, membershipStatus: 'ENDED' })).toBeNull(); // درآمد کسب‌شده پس از پایان همکاری هم قابل تسویه است
    expect(payoutRejection({ ...ok, amount: 400_000 })?.code).toBe('BELOW_MINIMUM');
    expect(payoutRejection({ ...ok, amount: 1_000_000 })?.code).toBe('INSUFFICIENT_BALANCE');
    expect(payoutRejection({ ...ok, hasOpenPayout: true })?.code).toBe('OPEN_PAYOUT_EXISTS');
    expect(payoutRejection({ ...ok, shebaVerified: false })?.code).toBe('SHEBA_NOT_VERIFIED');
    expect(payoutRejection({ ...ok, membershipStatus: 'SUSPENDED' })?.code).toBe('MEMBERSHIP_NOT_ELIGIBLE');
    expect(payoutRejection({ ...ok, amount: 0 })?.code).toBe('INVALID_AMOUNT');
    expect(payoutRejection({ ...ok, amount: 1.5 })?.code).toBe('INVALID_AMOUNT');
  });

  it('status transitions', () => {
    expect(canTransitionPayout('REQUESTED', 'APPROVED')).toBe(true);
    expect(canTransitionPayout('APPROVED', 'PAID')).toBe(true);
    expect(canTransitionPayout('REQUESTED', 'PAID')).toBe(false);
    expect(canTransitionPayout('PAID', 'REJECTED')).toBe(false);
    expect(canTransitionPayout('APPROVED', 'CANCELLED')).toBe(false);
    expect(canTransitionPayout('APPROVED', 'REJECTED')).toBe(true);
  });

  it('referral link for the business card', () => {
    expect(referralUrl('https://amlak.example/signup?r={code}', null, 'AB 12')).toBe('https://amlak.example/signup?r=AB%2012');
    expect(referralUrl(null, 'https://amlak.example/', 'AB12')).toBe('https://amlak.example/?ref=AB12');
    expect(referralUrl(null, 'https://amlak.example/?utm=x', 'AB12')).toBe('https://amlak.example/?utm=x&ref=AB12');
    expect(referralUrl('javascript:alert({code})', null, 'x')).toBeNull();
    expect(referralUrl(null, null, 'x')).toBeNull();
    expect(referralUrl(null, 'https://a.example', null)).toBeNull();
  });
});
