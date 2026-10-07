import { describe, expect, it, vi } from 'vitest';
import { globalCorsDelegate, isPublicFormsPath, MAX_PUBLIC_FORM_BODY_BYTES, publicFormsCorsMiddleware } from './public-forms-cors.js';

function run(method: string, url: string, headers: Record<string, string> = {}) {
  const set: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader: (k: string, v: string) => (set[k] = v),
    end: vi.fn(),
  };
  const next = vi.fn();
  publicFormsCorsMiddleware({ method, url, headers } as never, res as never, next);
  return { res, set, next };
}

describe('public forms CORS', () => {
  it('matches only the public forms prefix', () => {
    expect(isPublicFormsPath('/api/public/forms/t1/x/submit')).toBe(true);
    expect(isPublicFormsPath('/api/public/store/x')).toBe(false);
    expect(isPublicFormsPath('/api/forms')).toBe(false);
  });

  it('answers preflight with * and never allows credentials', () => {
    const { res, set, next } = run('OPTIONS', '/api/public/forms/t1/x/submit');
    expect(res.statusCode).toBe(204);
    expect(set['Access-Control-Allow-Origin']).toBe('*');
    expect(set['Access-Control-Allow-Credentials']).toBeUndefined();
    expect(set['Access-Control-Allow-Methods']).toContain('POST');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects oversized POST bodies before parsing (413) and lets normal ones through', () => {
    const big = run('POST', '/api/public/forms/t1/x/submit', { 'content-length': String(MAX_PUBLIC_FORM_BODY_BYTES + 1) });
    expect(big.res.statusCode).toBe(413);
    expect(big.next).not.toHaveBeenCalled();
    const ok = run('POST', '/api/public/forms/t1/x/submit', { 'content-length': '500' });
    expect(ok.next).toHaveBeenCalled();
    const chunked = run('POST', '/api/public/forms/t1/x/submit', { 'transfer-encoding': 'chunked' });
    expect(chunked.res.statusCode).toBe(411);
  });

  it('ignores other paths', () => {
    const r = run('OPTIONS', '/api/crm/contacts');
    expect(r.next).toHaveBeenCalled();
    expect(r.set['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('global cors delegate: no cors headers/credentials on public forms, credentials elsewhere', () => {
    const d = globalCorsDelegate(['http://app.test']);
    let opts: Record<string, unknown> = {};
    d({ url: '/api/public/forms/a/b' }, (_e, o) => (opts = o));
    expect(opts).toEqual({ origin: false, credentials: false });
    d({ url: '/api/crm' }, (_e, o) => (opts = o));
    expect(opts).toEqual({ origin: ['http://app.test'], credentials: true });
  });
});
