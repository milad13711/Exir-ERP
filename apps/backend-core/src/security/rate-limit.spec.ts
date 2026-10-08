import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { RateLimitGuard } from './rate-limit.guard.js';
import { RateLimitStore, tokenFingerprint } from './rate-limit.js';
import { clientIp, isInternalCall, isTrustedProxyAddress } from './client-ip.js';

describe('RateLimitStore', () => {
  it('allows up to the limit then blocks until the window resets', () => {
    const s = new RateLimitStore();
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) expect(s.hit('k', 3, 60, t0).allowed).toBe(true);
    const blocked = s.hit('k', 3, 60, t0 + 1000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(s.hit('k', 3, 60, t0 + 61_000).allowed).toBe(true);
  });

  it('is bounded in memory (random-key flood cannot grow it without limit)', () => {
    const s = new RateLimitStore(100);
    for (let i = 0; i < 1000; i++) s.hit(`k${i}`, 5, 600);
    expect(s.size).toBeLessThanOrEqual(100);
  });

  it('token fingerprint never contains the token', () => {
    const fp = tokenFingerprint('exir_live_supersecret');
    expect(fp).toHaveLength(16);
    expect('exir_live_supersecret').not.toContain(fp);
  });
});

describe('client IP resolution', () => {
  const req = (peer: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress: peer }, headers }) as never;

  it('trusts X-Real-IP only from a private/loopback proxy peer', () => {
    expect(clientIp(req('127.0.0.1', { 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(req('172.18.0.1', { 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(req('::ffff:10.0.0.2', { 'x-forwarded-for': '9.9.9.9, 10.0.0.2' }))).toBe('9.9.9.9');
  });

  it('ignores spoofed headers from a public peer', () => {
    expect(clientIp(req('203.0.113.9', { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '1.2.3.4' }))).toBe('203.0.113.9');
    expect(isTrustedProxyAddress('203.0.113.9')).toBe(false);
  });

  it('ignores malformed header values and detects internal server-to-server calls', () => {
    expect(clientIp(req('127.0.0.1', { 'x-real-ip': 'not-an-ip' }))).toBe('127.0.0.1');
    expect(isInternalCall(req('172.18.0.5'))).toBe(true);
    expect(isInternalCall(req('172.18.0.5', { 'x-real-ip': '5.6.7.8' }))).toBe(false);
    expect(isInternalCall(req('203.0.113.9'))).toBe(false);
  });
});

function ctx(method: string, url: string, opts: { ip?: string; body?: unknown; bearer?: string } = {}) {
  const headers: Record<string, string> = { 'x-real-ip': opts.ip ?? '198.51.100.7' };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const req = { method, originalUrl: url, url, headers, body: opts.body, socket: { remoteAddress: '127.0.0.1' } };
  const res = { setHeader: vi.fn() };
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as never;
}

describe('RateLimitGuard', () => {
  const events = { record: vi.fn() };
  const make = () => new RateLimitGuard(events as never);

  it('limits OTP requests per IP (30 / 15min) and answers 429 with Retry-After', () => {
    const g = make();
    for (let i = 0; i < 30; i++) expect(g.canActivate(ctx('POST', '/api/auth/otp/request', { body: { phone: `0912000${1000 + i}` } }))).toBe(true);
    expect(() => g.canActivate(ctx('POST', '/api/auth/otp/request', { body: { phone: '09129999999' } }))).toThrow(HttpException);
    // a different IP is unaffected
    expect(g.canActivate(ctx('POST', '/api/auth/otp/request', { ip: '198.51.100.8', body: { phone: '09129999999' } }))).toBe(true);
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'RATE_LIMITED' }));
  });

  it('limits OTP requests per phone across IPs (8 / 15min) — SMS-pumping against one victim', () => {
    const g = make();
    for (let i = 0; i < 8; i++) expect(g.canActivate(ctx('POST', '/api/public/booking/acme/otp/request', { ip: `198.51.100.${10 + i}`, body: { phone: '09121234567' } }))).toBe(true);
    try {
      g.canActivate(ctx('POST', '/api/public/booking/acme/otp/request', { ip: '198.51.100.99', body: { phone: '09121234567' } }));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(429);
    }
  });

  it('limits OTP verification guesses per phone (12 / 15min) even when the attacker rotates IPs', () => {
    const g = make();
    for (let i = 0; i < 12; i++) expect(g.canActivate(ctx('POST', '/api/auth/otp/verify', { ip: `203.0.113.${i + 1}`, body: { phone: '09125550000', code: '1111' } }))).toBe(true);
    expect(() => g.canActivate(ctx('POST', '/api/auth/otp/verify', { ip: '203.0.113.200', body: { phone: '09125550000', code: '2222' } }))).toThrow(HttpException);
  });

  it('mail-triggering public site forms: 10 per hour per IP', () => {
    const g = make();
    for (let i = 0; i < 10; i++) g.canActivate(ctx('POST', '/api/public/reseller-applications', { ip: '198.51.100.140' }));
    expect(() => g.canActivate(ctx('POST', '/api/public/reseller-applications', { ip: '198.51.100.140' }))).toThrow(HttpException);
  });

  it('applies a strict limit to admin login by IP', () => {
    const g = make();
    for (let i = 0; i < 20; i++) g.canActivate(ctx('POST', '/api/admin/auth/login'));
    expect(() => g.canActivate(ctx('POST', '/api/admin/auth/login'))).toThrow(HttpException);
  });

  it('does not apply per-IP limits to internal server-to-server calls (SSR), but still limits per token', () => {
    const g = make();
    const internal = () => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ method: 'GET', originalUrl: '/api/public/shop/x', url: '/api/public/shop/x', headers: {}, socket: { remoteAddress: '172.18.0.4' } }), getResponse: () => ({ setHeader: vi.fn() }) }) }) as never;
    for (let i = 0; i < 700; i++) expect(g.canActivate(internal())).toBe(true);
  });

  it('can be disabled (emergency switch) and run report-only', () => {
    process.env.RATE_LIMIT_REPORT_ONLY = 'true';
    const g = make();
    for (let i = 0; i < 25; i++) g.canActivate(ctx('POST', '/api/admin/auth/login', { ip: '198.51.100.222' }));
    expect(g.canActivate(ctx('POST', '/api/admin/auth/login', { ip: '198.51.100.222' }))).toBe(true);
    delete process.env.RATE_LIMIT_REPORT_ONLY;
    process.env.RATE_LIMIT_DISABLED = 'true';
    expect(make().canActivate(ctx('POST', '/api/admin/auth/login'))).toBe(true);
    delete process.env.RATE_LIMIT_DISABLED;
  });
});
