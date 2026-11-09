import { describe, expect, it } from 'vitest';
import { validateEvent } from './agent-event-validator.js';

const now = new Date('2026-11-08T10:00:00Z');
const reg = { eventId: 'evt-1', type: 'customer.registered', data: { referralCode: 'ali-01', externalCustomerId: 'u_1', name: 'مشتری', phone: '۰۹۱۲۳۴۵۶۷۸۹', email: 'a@b.co' } };
const sub = (over: Record<string, unknown> = {}) => ({
  eventId: 'evt-2',
  type: 'subscription.activated',
  data: { externalCustomerId: 'u_1', planCode: 'PRO', planName: 'حرفه‌ای', amount: 1_000_000, currency: 'irt', paidAt: '2026-11-08T09:00:00Z', periodEnd: '2026-12-08T09:00:00Z', paymentRef: 'pay_1', ...over },
});

describe('validateEvent', () => {
  it('normalizes customer.registered (upper-cased code, Latin phone)', () => {
    const r = validateEvent(reg, now);
    expect(r.ok).toBe(true);
    if (r.ok && r.event.type === 'customer.registered') {
      expect(r.event.data.referralCode).toBe('ALI-01');
      expect(r.event.data.phone).toBe('09123456789');
    }
  });
  it('rejects non-objects, unknown keys (top level and data), unknown type', () => {
    expect(validateEvent(null, now).ok).toBe(false);
    expect(validateEvent([], now).ok).toBe(false);
    expect(validateEvent({ ...reg, extra: 1 }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, data: { ...reg.data, role: 'admin' } }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, type: 'user.deleted' }, now).ok).toBe(false);
  });
  it('requires eventId in a safe charset and bounded length', () => {
    expect(validateEvent({ ...reg, eventId: '' }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, eventId: 'a b' }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, eventId: 'x'.repeat(101) }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, eventId: "x'; drop" }, now).ok).toBe(false);
  });
  it('validates phone/email/code formats', () => {
    expect(validateEvent({ ...reg, data: { ...reg.data, phone: '123' } }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, data: { ...reg.data, email: 'nope' } }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, data: { ...reg.data, referralCode: 'a b' } }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, data: { ...reg.data, name: 'x' } }, now).ok).toBe(false);
  });
  it('validates subscription amounts, currency, dates and period order', () => {
    expect(validateEvent(sub(), now).ok).toBe(true);
    expect(validateEvent(sub({ amount: 12.5 }), now).ok).toBe(false);
    expect(validateEvent(sub({ amount: -1 }), now).ok).toBe(false);
    expect(validateEvent(sub({ amount: '1000' }), now).ok).toBe(false);
    expect(validateEvent(sub({ amount: 3_000_000_000 }), now).ok).toBe(false);
    expect(validateEvent(sub({ currency: 'USD' }), now).ok).toBe(false);
    expect(validateEvent(sub({ paidAt: 'yesterday' }), now).ok).toBe(false);
    expect(validateEvent(sub({ periodEnd: '2026-11-01T00:00:00Z' }), now).ok).toBe(false);
    expect(validateEvent(sub({ amount: 0 }), now).ok).toBe(false);
    expect(validateEvent(sub({ amount: 0, isTrial: true }), now).ok).toBe(true);
    expect(validateEvent(sub({ isTrial: 'yes' }), now).ok).toBe(false);
  });
  it('refund and cancel shapes', () => {
    expect(validateEvent({ eventId: 'e3', type: 'payment.refunded', data: { paymentRef: 'pay_1', amount: 500, currency: 'IRT' } }, now).ok).toBe(true);
    expect(validateEvent({ eventId: 'e3', type: 'payment.refunded', data: { paymentRef: 'pay_1', currency: 'IRT' } }, now).ok).toBe(false);
    expect(validateEvent({ eventId: 'e4', type: 'subscription.cancelled', data: { externalCustomerId: 'u_1', reason: 'x'.repeat(301) } }, now).ok).toBe(false);
    expect(validateEvent({ eventId: 'e4', type: 'subscription.cancelled', data: { externalCustomerId: 'u_1' } }, now).ok).toBe(true);
  });
  it('rejects occurredAt far in the future', () => {
    expect(validateEvent({ ...reg, occurredAt: '2027-01-01T00:00:00Z' }, now).ok).toBe(false);
    expect(validateEvent({ ...reg, occurredAt: '2026-11-08T09:00:00Z' }, now).ok).toBe(true);
  });
});
