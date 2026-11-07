import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ROUTE_ROOTS,
  buildSmsText,
  cleanChange,
  cleanChanges,
  isRetryable,
  isSafeDeepLink,
  isValidVersion,
  normalizeChannels,
  normalizeDeepLink,
  normalizePrefs,
  plainText,
  ReleaseValidationError,
  releaseLink,
  tehranDay,
} from './module-release.logic.js';

describe('plainText (sanitization)', () => {
  it('strips HTML tags and angle brackets', () => {
    expect(plainText('<script>alert(1)</script>سلام <b>دنیا</b>', 100)).not.toMatch(/[<>]/);
    expect(plainText('a < b > c', 100)).toBe('a c');
  });
  it('removes control and bidi-override characters, collapses spaces', () => {
    expect(plainText('x\u0000y‮z   w', 100)).toBe('x y z w');
  });
  it('keeps newlines only in multiline mode and clips length', () => {
    expect(plainText('a\nb', 10)).toBe('a b');
    expect(plainText('a\n\n\n\nb', 10, true)).toBe('a\n\nb');
    expect(plainText('abcdefghij', 4)).toBe('abcd');
  });
  it('non-strings become empty', () => {
    expect(plainText(undefined, 10)).toBe('');
    expect(plainText(42, 10)).toBe('');
  });
});

describe('deep links', () => {
  it('accepts internal module routes', () => {
    for (const ok of ['/sales', '/sales/invoices', '/accounting?tab=books', '/crm/funnel']) expect(isSafeDeepLink(ok), ok).toBe(true);
  });
  it('rejects dangerous or external targets', () => {
    for (const bad of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com', '/sales/../admin', '/unknown-root', '/sales#x', 'sales', '/Sales', '/data:text/html', '/sales?x=<script>']) {
      expect(isSafeDeepLink(bad), bad).toBe(false);
    }
  });
  it('normalizeDeepLink: empty is null, invalid throws', () => {
    expect(normalizeDeepLink('')).toBeNull();
    expect(normalizeDeepLink(undefined)).toBeNull();
    expect(normalizeDeepLink('/sales')).toBe('/sales');
    expect(() => normalizeDeepLink('https://x.y')).toThrow();
  });
  it('allowlist contains module roots', () => {
    expect(ALLOWED_ROUTE_ROOTS.has('sales')).toBe(true);
    expect(ALLOWED_ROUTE_ROOTS.has('admin')).toBe(false);
  });
});

describe('release input cleaning', () => {
  it('cleans a change, defaults unknown type to NEW', () => {
    const c = cleanChange({ type: 'weird', title: '<i>خروجی</i> اکسل', description: 'd', valueText: 'v', deepLink: '/sales' }, 0);
    expect(c).toEqual({ type: 'NEW', title: 'خروجی اکسل', description: 'd', valueText: 'v', deepLink: '/sales' });
  });
  it('rejects empty title and bad link with Persian message', () => {
    expect(() => cleanChange({ title: '   ' }, 0)).toThrow(ReleaseValidationError);
    expect(() => cleanChange({ title: 'x', deepLink: 'https://evil.com' }, 2)).toThrow(/شماره 3/);
  });
  it('caps the number of changes', () => {
    expect(() => cleanChanges(Array.from({ length: 41 }, () => ({ title: 'x' })))).toThrow(ReleaseValidationError);
  });
  it('version format', () => {
    expect(isValidVersion('1.4.0')).toBe(true);
    expect(isValidVersion('2.0.0-beta.1')).toBe(true);
    expect(isValidVersion('1.0 <x>')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });
  it('channels default to off; notify/ticket prefs default on, SMS is opt-in (off)', () => {
    expect(normalizeChannels(undefined)).toEqual({ notify: false, ticket: false, sms: false });
    expect(normalizeChannels({ sms: true, notify: 'yes' })).toEqual({ notify: false, ticket: false, sms: true });
    expect(normalizePrefs(undefined)).toEqual({ notify: true, ticket: true, sms: false });
    expect(normalizePrefs({ sms: true })).toEqual({ notify: true, ticket: true, sms: true });
    expect(normalizePrefs({ sms: 'yes' }).sms).toBe(false);
    expect(normalizePrefs({ sms: false, notify: false })).toEqual({ notify: false, ticket: true, sms: false });
  });
});

describe('SMS text', () => {
  it('contains module name, version and the short link only (no free admin text)', () => {
    const link = releaseLink('abc2345', 'https://app.example.ir/');
    expect(link).toBe('https://app.example.ir/releases/abc2345');
    const t = buildSmsText('فروش و فاکتور', '1.4.0', link);
    expect(t).toContain('فروش و فاکتور');
    expect(t).toContain('1.4.0');
    expect(t.endsWith(link)).toBe(true);
    expect(t.length).toBeLessThan(120);
  });
  it('strips URLs/HTML from a hostile module name and drops invalid versions', () => {
    const t = buildSmsText('<b>x</b> http://evil.com/phish', '1.0 <x>', 'https://a.ir/releases/q');
    expect(t).not.toContain('evil.com');
    expect(t).not.toMatch(/[<>]/);
    expect(t).not.toContain('نسخه');
  });
});

describe('retry eligibility and misc', () => {
  const now = new Date('2026-11-01T10:00:00Z');
  const row = (status: string, reason: string | null, ageMin: number) => ({ status, reason, updatedAt: new Date(now.getTime() - ageMin * 60_000) });
  it('never retries SENT or final skips', () => {
    expect(isRetryable(row('SENT', null, 999), now)).toBe(false);
    expect(isRetryable(row('SKIPPED', 'OPTED_OUT', 999), now)).toBe(false);
    expect(isRetryable(row('SKIPPED', 'NO_RECIPIENT', 999), now)).toBe(false);
  });
  it('retries failed/partial, retryable skips and stale pending only', () => {
    expect(isRetryable(row('FAILED', 'x', 0), now)).toBe(true);
    expect(isRetryable(row('PARTIAL', null, 0), now)).toBe(true);
    expect(isRetryable(row('SKIPPED', 'DAILY_CAP', 0), now)).toBe(true);
    expect(isRetryable(row('SKIPPED', 'NO_SMS_CHANNEL', 0), now)).toBe(true);
    expect(isRetryable(row('PENDING', null, 1), now)).toBe(false);
    expect(isRetryable(row('PENDING', null, 30), now)).toBe(true);
  });
  it('tehranDay shifts by +3:30', () => {
    expect(tehranDay(new Date('2026-11-01T21:00:00Z'))).toBe('2026-11-02');
    expect(tehranDay(new Date('2026-11-01T10:00:00Z'))).toBe('2026-11-01');
  });
});
