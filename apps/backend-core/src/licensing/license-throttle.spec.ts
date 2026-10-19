import { describe, expect, it } from 'vitest';
import { LicenseThrottle, equalizeTiming } from './license-throttle.js';

describe('LicenseThrottle', () => {
  const opts = { perMinute: 5, maxFailures: 3, failWindowMs: 60_000, baseLockMs: 1000, maxLockMs: 8000, trustedMs: 60_000, maxEntries: 100 };

  it('rate limits per IP per minute and recovers in the next window', () => {
    const t = new LicenseThrottle(opts);
    for (let i = 0; i < 5; i++) expect(t.check('1.1.1.1', 0).allowed).toBe(true);
    const v = t.check('1.1.1.1', 10);
    expect(v).toMatchObject({ allowed: false, reason: 'rate' });
    expect(t.check('2.2.2.2', 10).allowed).toBe(true);
    expect(t.check('1.1.1.1', 61_000).allowed).toBe(true);
  });

  it('locks after repeated key-guess failures with exponential backoff', () => {
    const t = new LicenseThrottle({ ...opts, perMinute: 1000 });
    const ip = '9.9.9.9';
    let now = 0;
    for (let i = 0; i < 3; i++) t.recordFailure(ip, now);
    const v1 = t.check(ip, 10);
    expect(v1).toMatchObject({ allowed: false, reason: 'locked' });
    expect((v1 as { retryAfterSec: number }).retryAfterSec).toBeLessThanOrEqual(1);
    now = 2000;
    expect(t.check(ip, now).allowed).toBe(true);
    for (let i = 0; i < 3; i++) t.recordFailure(ip, now);
    const v2 = t.check(ip, now + 10);
    expect((v2 as { retryAfterSec: number }).retryAfterSec).toBeGreaterThanOrEqual(2); // doubled
    for (let k = 0; k < 6; k++) {
      now += 100_000;
      for (let i = 0; i < 3; i++) t.recordFailure(ip, now);
    }
    expect((t.check(ip, now + 10) as { retryAfterSec: number }).retryAfterSec).toBeLessThanOrEqual(8); // capped
  });

  it('does not lock one IP because of another IP (no victim DoS)', () => {
    const t = new LicenseThrottle(opts);
    for (let i = 0; i < 10; i++) t.recordFailure('6.6.6.6', 0);
    expect(t.check('7.7.7.7', 1).allowed).toBe(true);
  });

  it('success relaxes the lock level', () => {
    const t = new LicenseThrottle({ ...opts, perMinute: 1000 });
    t.recordFailure('a', 0);
    t.recordFailure('a', 0);
    t.recordSuccess('a');
    t.recordFailure('a', 0);
    expect(t.check('a', 1).allowed).toBe(true);
  });
});

describe('throttle hardening', () => {
  const opts = { perMinute: 1000, maxFailures: 2, failWindowMs: 60_000, baseLockMs: 1000, maxLockMs: 3000, trustedMs: 60_000, maxEntries: 10 };
  it('IPv6 addresses in the same /64 share one bucket', () => {
    const t = new LicenseThrottle(opts);
    t.recordFailure('2001:db8:1:2:aaaa::1', 0);
    t.recordFailure('2001:db8:1:2:bbbb::9', 0);
    expect(t.check('2001:db8:1:2:cccc::5', 1).allowed).toBe(false);
    expect(t.check('2001:db8:1:3::1', 1).allowed).toBe(true);
  });
  it('lock is capped (CGNAT) and trusted installations bypass it', () => {
    const t = new LicenseThrottle(opts);
    t.recordSuccess('5.5.5.5', 'i-good', 0);
    for (let k = 0; k < 10; k++) { t.recordFailure('5.5.5.5', k); t.recordFailure('5.5.5.5', k); }
    expect(t.check('5.5.5.5', 100).allowed).toBe(false);
    expect(t.check('5.5.5.5', 100, 'i-good').allowed).toBe(true);
    expect((t.check('5.5.5.5', 100) as { retryAfterSec: number }).retryAfterSec).toBeLessThanOrEqual(3);
  });
  it('memory is bounded under random-IP floods', () => {
    const t = new LicenseThrottle(opts);
    for (let i = 0; i < 500; i++) t.check(`10.0.${i >> 8}.${i & 255}`, 0);
    expect((t as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(10);
  });
});

describe('equalizeTiming', () => {
  it('pads fast responses to a minimum duration', async () => {
    const started = Date.now();
    await equalizeTiming(started, 60, 1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });
});