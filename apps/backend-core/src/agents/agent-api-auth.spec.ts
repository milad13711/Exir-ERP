import { describe, expect, it } from 'vitest';
import { TIMESTAMP_WINDOW_SEC, SlidingWindowLimiter, computeSignature, generateAgentKey, hashAgentKey, maskAgentKey, parseBearerKey, safeEqualHex, verifySignature } from './agent-api-auth.js';

describe('agent API key', () => {
  it('generates a prefixed random key with a stable sha256 hash and a separate signing secret', () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    expect(a.key).toMatch(/^exir_agent_[A-Za-z0-9_-]{43}$/);
    expect(a.signingSecret).toMatch(/^exir_sign_/);
    expect(a.key).not.toBe(b.key);
    expect(a.keyHash).toBe(hashAgentKey(a.key));
    expect(a.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.keyHash).not.toContain(a.key);
    expect(a.keyPrefix.length).toBeLessThan(a.key.length / 2);
    expect(a.signingSecret).not.toBe(a.key);
  });
  it('masks after creation', () => {
    const a = generateAgentKey();
    const m = maskAgentKey(a.keyPrefix);
    expect(m.startsWith(a.keyPrefix)).toBe(true);
    expect(m).not.toContain(a.key.slice(20));
  });
  it('parseBearerKey rejects malformed headers before any DB lookup', () => {
    const k = generateAgentKey().key;
    expect(parseBearerKey(`Bearer ${k}`)).toBe(k);
    expect(parseBearerKey(undefined)).toBeNull();
    expect(parseBearerKey(k)).toBeNull();
    expect(parseBearerKey('Bearer exir_live_abcdefghijklmnopqrstuvwxyz0123456789')).toBeNull();
    expect(parseBearerKey('Bearer exir_agent_short')).toBeNull();
    expect(parseBearerKey(`Bearer ${k}; drop`)).toBeNull();
    expect(parseBearerKey(`Bearer ${'exir_agent_' + 'a'.repeat(300)}`)).toBeNull();
  });
  it('safeEqualHex is length-safe', () => {
    expect(safeEqualHex('ab', 'ab')).toBe(true);
    expect(safeEqualHex('ab', 'abc')).toBe(false);
    expect(safeEqualHex('ab', 'ac')).toBe(false);
  });
});

describe('HMAC signature + timestamp window', () => {
  const secret = 'exir_sign_secret';
  const body = '{"eventId":"e1","type":"customer.registered","data":{}}';
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const sig = computeSignature(secret, ts, body);

  it('accepts a correct signature (with or without sha256= prefix, ms timestamps)', () => {
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now })).toEqual({ ok: true });
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: `sha256=${sig.toUpperCase()}`, rawBody: body, nowMs: now }).ok).toBe(true);
    const tsMs = String(now);
    expect(verifySignature({ signingSecret: secret, timestamp: tsMs, signature: computeSignature(secret, tsMs, body), rawBody: body, nowMs: now }).ok).toBe(true);
  });
  it('rejects tampered body, wrong secret, missing headers', () => {
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: sig, rawBody: body + ' ', nowMs: now })).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
    expect(verifySignature({ signingSecret: 'other', timestamp: ts, signature: sig, rawBody: body, nowMs: now })).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
    expect(verifySignature({ signingSecret: secret, timestamp: undefined, signature: sig, rawBody: body, nowMs: now })).toEqual({ ok: false, code: 'MISSING_SIGNATURE' });
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: 'zz', rawBody: body, nowMs: now })).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
    expect(verifySignature({ signingSecret: secret, timestamp: 'abc', signature: sig, rawBody: body, nowMs: now })).toEqual({ ok: false, code: 'BAD_TIMESTAMP' });
  });
  it('enforces the 5 minute window both directions (replay of a stale signed request fails)', () => {
    const edge = now + TIMESTAMP_WINDOW_SEC * 1000;
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: sig, rawBody: body, nowMs: edge }).ok).toBe(true);
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: sig, rawBody: body, nowMs: edge + 1500 })).toEqual({ ok: false, code: 'TIMESTAMP_OUT_OF_WINDOW' });
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: sig, rawBody: body, nowMs: now - 301_000 })).toEqual({ ok: false, code: 'TIMESTAMP_OUT_OF_WINDOW' });
  });
  it('signature binds the timestamp (cannot move a signed body to a new time)', () => {
    const later = String(Number(ts) + 10);
    expect(verifySignature({ signingSecret: secret, timestamp: later, signature: sig, rawBody: body, nowMs: now })).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
  });
  it('empty body (GET) signs `ts.`', () => {
    expect(verifySignature({ signingSecret: secret, timestamp: ts, signature: computeSignature(secret, ts, ''), rawBody: '', nowMs: now }).ok).toBe(true);
  });
});

describe('SlidingWindowLimiter', () => {
  it('allows up to the limit per key per window then blocks, per-key isolated', () => {
    const l = new SlidingWindowLimiter(60_000);
    const t = 1_000;
    for (let i = 0; i < 3; i++) expect(l.allow('k1', 3, t + i)).toBe(true);
    expect(l.allow('k1', 3, t + 10)).toBe(false);
    expect(l.allow('k2', 3, t + 10)).toBe(true);
    expect(l.retryAfterSec('k1', t + 10)).toBeGreaterThan(0);
    expect(l.allow('k1', 3, t + 60_001)).toBe(true); // پنجره لغزید
  });
  it('prunes when the key table grows', () => {
    const l = new SlidingWindowLimiter(1000, 5);
    for (let i = 0; i < 20; i++) l.allow(`k${i}`, 1, i);
    expect(l.allow('fresh', 1, 5000)).toBe(true);
  });
});
