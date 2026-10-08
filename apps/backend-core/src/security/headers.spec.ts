import { describe, expect, it, vi } from 'vitest';
import { publicBodyLimitMiddleware, securityHeadersMiddleware } from './headers.js';

function res() {
  const h: Record<string, string> = {};
  return { h, setHeader: (k: string, v: string) => { h[k] = v; }, getHeader: (k: string) => h[k], removeHeader: vi.fn(), statusCode: 200, end: vi.fn() };
}

describe('securityHeadersMiddleware', () => {
  it('sets the baseline headers and a request id', () => {
    const r = res();
    const next = vi.fn();
    securityHeadersMiddleware({ headers: {}, url: '/api/x', method: 'GET' } as never, r as never, next);
    expect(r.h['X-Content-Type-Options']).toBe('nosniff');
    expect(r.h['X-Frame-Options']).toBe('DENY');
    expect(r.h['Referrer-Policy']).toBe('no-referrer');
    expect(r.h['Content-Security-Policy']).toContain("default-src 'none'");
    expect(r.h['X-Request-Id']).toMatch(/[0-9a-f-]{36}/);
    expect(r.h['Strict-Transport-Security']).toBeUndefined(); // plain HTTP
    expect(next).toHaveBeenCalled();
  });

  it('adds HSTS only behind HTTPS, keeps Swagger usable, and never trusts a malformed inbound request id', () => {
    const r = res();
    securityHeadersMiddleware({ headers: { 'x-forwarded-proto': 'https', 'x-request-id': 'bad id\r\nX: y' }, url: '/api/docs', method: 'GET' } as never, r as never, vi.fn());
    expect(r.h['Strict-Transport-Security']).toContain('max-age');
    expect(r.h['Content-Security-Policy']).toBeUndefined();
    expect(r.h['X-Request-Id']).not.toContain('bad');
  });
});

describe('publicBodyLimitMiddleware', () => {
  const run = (method: string, url: string, headers: Record<string, string>) => {
    const r = res();
    const next = vi.fn();
    publicBodyLimitMiddleware({ method, url, headers } as never, r as never, next);
    return { r, next };
  };

  it('caps auth bodies at 16KB and public bodies at 8MB, leaves authenticated routes (20MB) alone', () => {
    expect(run('POST', '/api/auth/otp/verify', { 'content-length': '20000' }).r.statusCode).toBe(413);
    expect(run('POST', '/api/auth/otp/verify', { 'content-length': '300' }).next).toHaveBeenCalled();
    expect(run('POST', '/api/public/booking/x/appointments', { 'content-length': String(9 * 1024 * 1024) }).r.statusCode).toBe(413);
    expect(run('POST', '/api/public/booking/x/appointments', { 'content-length': '5000' }).next).toHaveBeenCalled();
    expect(run('POST', '/api/crm/contacts', { 'content-length': String(15 * 1024 * 1024) }).next).toHaveBeenCalled();
  });

  it('rejects chunked bodies (no Content-Length) on unauthenticated routes', () => {
    expect(run('POST', '/api/admin/auth/login', { 'transfer-encoding': 'chunked' }).r.statusCode).toBe(411);
  });
});
