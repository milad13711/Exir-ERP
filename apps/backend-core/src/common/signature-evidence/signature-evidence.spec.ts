import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientSignatureEvidenceDto } from './signature-evidence.dto.js';
import { SignatureEvidenceService, normalizeGeo } from './signature-evidence.service.js';
import { computeIntegrityHash, formatTehran, hashContent, hashSignature, parseUserAgent, sha256Hex, stableStringify, verifyIntegrity } from './signature-evidence.util.js';

const KEY = 'a'.repeat(64);
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

const fields = () => ({
  id: 'e1',
  entityType: 'contract',
  entityId: 'c1',
  action: 'public_sign',
  signerName: 'علی',
  ip: '1.2.3.4',
  userAgent: UA_WIN,
  device: { b: 1, a: { y: 2, x: 1 } },
  geoStatus: 'granted',
  lat: 35.7,
  lng: 51.4,
  geoAccuracy: 12,
  serverTime: new Date('2026-10-14T10:00:00.000Z'),
  contentHash: 'h1',
  signatureHash: 'h2',
});

describe('hashing', () => {
  it('sha256 and stable stringify are order independent', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(hashContent({ x: 1, y: 2 })).toBe(hashContent({ y: 2, x: 1 }));
    expect(hashContent({ x: 1 })).not.toBe(hashContent({ x: 2 }));
    expect(hashSignature(undefined)).toBeUndefined();
    expect(hashSignature('data:image/png;base64,AAA')).toBe(sha256Hex('data:image/png;base64,AAA'));
  });
  it('formats Tehran time', () => {
    expect(formatTehran(new Date('2026-10-14T10:00:00.000Z'))).toBe('2026-10-14 13:30:00 (Asia/Tehran)');
  });
});

describe('integrity', () => {
  beforeEach(() => {
    process.env.APP_SECRETS_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.APP_SECRETS_KEY;
  });
  it('HMAC verifies and detects tampering, tolerant to jsonb key reorder', () => {
    const f = fields();
    const integrityHash = computeIntegrityHash(f);
    expect(integrityHash.startsWith('hmac:')).toBe(true);
    expect(verifyIntegrity({ ...f, integrityHash })).toBe(true);
    expect(verifyIntegrity({ ...f, device: { a: { x: 1, y: 2 }, b: 1 }, integrityHash })).toBe(true);
    expect(verifyIntegrity({ ...f, ip: '9.9.9.9', integrityHash })).toBe(false);
    expect(verifyIntegrity({ ...f, lat: 36, integrityHash })).toBe(false);
    expect(verifyIntegrity({ ...f, integrityHash: 'hmac:00' })).toBe(false);
  });
  it('a different key fails verification; missing key falls back to unkeyed sha256', () => {
    const f = fields();
    const h = computeIntegrityHash(f);
    process.env.APP_SECRETS_KEY = 'b'.repeat(64);
    expect(verifyIntegrity({ ...f, integrityHash: h })).toBe(false);
    delete process.env.APP_SECRETS_KEY;
    expect(verifyIntegrity({ ...f, integrityHash: h })).toBe(false);
    const unkeyed = computeIntegrityHash(f);
    expect(unkeyed.startsWith('sha256:')).toBe(true);
    expect(verifyIntegrity({ ...f, integrityHash: unkeyed })).toBe(true);
    expect(verifyIntegrity({ ...f, integrityHash: 'junk' })).toBe(false);
  });
});

describe('parseUserAgent', () => {
  it('parses iPhone Safari and Windows Edge', () => {
    expect(parseUserAgent(UA_IPHONE)).toMatchObject({ os: 'iOS', browser: 'Safari', deviceType: 'mobile' });
    expect(parseUserAgent(UA_WIN)).toMatchObject({ os: 'Windows', browser: 'Edge', deviceType: 'desktop' });
    expect(parseUserAgent(undefined)).toMatchObject({ browser: 'unknown', deviceType: 'unknown' });
  });
});

describe('normalizeGeo (consent paths)', () => {
  it('granted with coords', () => {
    expect(normalizeGeo({ status: 'granted', lat: 35.7, lng: 51.4, accuracy: 20 })).toEqual({ geoStatus: 'granted', lat: 35.7, lng: 51.4, geoAccuracy: 20 });
  });
  it('denied / unavailable / missing never block and carry no coordinates', () => {
    expect(normalizeGeo({ status: 'denied', lat: 1, lng: 2 })).toEqual({ geoStatus: 'denied' });
    expect(normalizeGeo({ status: 'unavailable' })).toEqual({ geoStatus: 'unavailable' });
    expect(normalizeGeo(undefined)).toEqual({ geoStatus: 'unavailable' });
    expect(normalizeGeo({ status: 'granted' })).toEqual({ geoStatus: 'unavailable' });
  });
});

describe('SignatureEvidenceService', () => {
  const mkDb = () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data, createdAt: new Date() }));
    const findMany = vi.fn(async () => []);
    return { db: { signatureEvidence: { create, findMany } }, create, findMany };
  };
  const req = (headers: Record<string, string>, remote = '127.0.0.1') => ({ headers, socket: { remoteAddress: remote } }) as never;

  beforeEach(() => {
    process.env.APP_SECRETS_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.APP_SECRETS_KEY;
  });

  it('record persists real client IP (behind nginx), UA, device, hashes and a verifiable integrity hash', async () => {
    const { db, create } = mkDb();
    const svc = new SignatureEvidenceService();
    const rec = await svc.record({ tenantDb: db } as never, {
      entityType: 'contract',
      entityId: 'c1',
      action: 'public_sign',
      signerName: 'علی',
      signerPhone: '09120000000',
      contentHash: 'abc',
      signatureData: 'data:image/png;base64,AAA',
      req: req({ 'x-real-ip': '5.6.7.8', 'user-agent': UA_IPHONE }),
      clientEvidence: { clientTime: '2026-10-14T10:00:01.000Z', timezone: 'Asia/Tehran', language: 'fa-IR', platform: 'iPhone', screen: { w: 390, h: 844 }, touch: true, geo: { status: 'granted', lat: 35.7, lng: 51.4, accuracy: 15 } },
    });
    const data = create.mock.calls[0][0].data;
    expect(data.ip).toBe('5.6.7.8');
    expect(data.userAgent).toBe(UA_IPHONE);
    expect(data.geoStatus).toBe('granted');
    expect(data.lat).toBe(35.7);
    expect(data.signatureHash).toBe(sha256Hex('data:image/png;base64,AAA'));
    expect(data.contentHash).toBe('abc');
    expect(data.device).toMatchObject({ os: 'iOS', browser: 'Safari', timezone: 'Asia/Tehran', touch: true, screen: { w: 390, h: 844 } });
    expect((data.device as { serverTimeTehran: string }).serverTimeTehran).toContain('Asia/Tehran');
    expect(svc.verify(rec as never)).toBe(true);
    expect(svc.verify({ ...(rec as object), ip: '1.1.1.1' } as never)).toBe(false);
  });

  it('ignores spoofed X-Real-IP from an untrusted peer', async () => {
    const { db, create } = mkDb();
    await new SignatureEvidenceService().record(db as never, { entityType: 'x', entityId: '1', action: 'a', req: req({ 'x-real-ip': '5.6.7.8' }, '203.0.113.9') });
    expect(create.mock.calls[0][0].data.ip).toBe('203.0.113.9');
  });

  it('records denied geolocation and works with no client evidence at all', async () => {
    const { db, create } = mkDb();
    const svc = new SignatureEvidenceService();
    await svc.record(db as never, { entityType: 'x', entityId: '1', action: 'a', req: req({}), clientEvidence: { geo: { status: 'denied' } } });
    expect(create.mock.calls[0][0].data).toMatchObject({ geoStatus: 'denied', lat: null, lng: null });
    await svc.record(db as never, { entityType: 'x', entityId: '1', action: 'a', req: req({}) });
    expect(create.mock.calls[1][0].data.geoStatus).toBe('unavailable');
  });

  it('tryRecord swallows persistence failures; record propagates', async () => {
    const svc = new SignatureEvidenceService();
    const db = { signatureEvidence: { create: vi.fn(async () => { throw new Error('boom'); }) } };
    const input = { entityType: 'x', entityId: '1', action: 'a', req: req({}) };
    await expect(svc.record(db as never, input)).rejects.toThrow('boom');
    await expect(svc.tryRecord(db as never, input)).resolves.toBeNull();
  });

  it('listFor queries by entity', async () => {
    const { db, findMany } = mkDb();
    await new SignatureEvidenceService().listFor({ tenantDb: db } as never, 'contract', 'c1');
    expect(findMany).toHaveBeenCalledWith({ where: { entityType: 'contract', entityId: 'c1' }, orderBy: { serverTime: 'asc' } });
  });
});

describe('ClientSignatureEvidenceDto', () => {
  const check = (o: unknown) => validate(plainToInstance(ClientSignatureEvidenceDto, o), { whitelist: true, forbidNonWhitelisted: true });
  it('accepts a full valid payload and an empty one', async () => {
    expect(await check({ clientTime: '2026-10-14T10:00:00Z', timezone: 'Asia/Tehran', language: 'fa', platform: 'x', screen: { w: 1, h: 2 }, touch: false, geo: { status: 'granted', lat: 1, lng: 2, accuracy: 3 } })).toHaveLength(0);
    expect(await check({})).toHaveLength(0);
  });
  it('rejects bad geo status and out-of-range coordinates', async () => {
    expect((await check({ geo: { status: 'maybe' } })).length).toBeGreaterThan(0);
    expect((await check({ geo: { status: 'granted', lat: 200, lng: 0 } })).length).toBeGreaterThan(0);
    expect((await check({ touch: 'yes' })).length).toBeGreaterThan(0);
  });
});
