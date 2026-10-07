import { describe, expect, it } from 'vitest';
import { decideCors, normalizeOrigin, normalizeOrigins } from './embed-origins.js';
import { SlidingWindowLimiter } from './rate-limiter.js';

describe('embed origins', () => {
  it('normalizes to a lowercase origin and rejects non-http(s)', () => {
    expect(normalizeOrigin('HTTPS://Example.com/a/b?x=1')).toBe('https://example.com');
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
    expect(normalizeOrigins(['https://a.com/x', 'https://a.com', 'ftp://b.com', 'http://c.com:8080'])).toEqual(['https://a.com', 'http://c.com:8080']);
  });

  it('public by default: wildcard, no vary', () => {
    expect(decideCors([], 'https://anything.com')).toEqual({ allowed: true, allowOrigin: '*', vary: false });
  });

  it('restricted: echoes only listed origins; server-to-server (no Origin) passes', () => {
    const list = ['https://shop.example.com'];
    expect(decideCors(list, 'https://shop.example.com')).toEqual({ allowed: true, allowOrigin: 'https://shop.example.com', vary: true });
    expect(decideCors(list, 'https://evil.com')).toEqual({ allowed: false });
    expect(decideCors(list, 'https://shop.example.com.evil.com')).toEqual({ allowed: false });
    expect(decideCors(list, undefined).allowed).toBe(true);
  });
});

describe('SlidingWindowLimiter', () => {
  it('blocks after max hits within the window and frees up afterwards', () => {
    let t = 0;
    const l = new SlidingWindowLimiter(2, 1000, () => t);
    expect(l.take('a')).toBe(true);
    expect(l.take('a')).toBe(true);
    expect(l.take('a')).toBe(false);
    expect(l.take('b')).toBe(true);
    t = 1500;
    expect(l.take('a')).toBe(true);
  });
});
