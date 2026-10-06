import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { HttpMoodianClient, assertAllowedBaseUrl, MoodianTransportError } from './http-moodian.client.js';
import { FakeMoodianClient } from './fake-moodian.client.js';
import { SendRefusedError, assertSendAllowed, hashNormalized } from './send-guard.js';
import type { ClientLogEntry, ClientSettingsView, MoodianClientConfig, SendPermit } from './moodian-client.js';
import { decryptInvoicePacket } from '../crypto/packet-crypto.js';
import { normalizeJson } from '../crypto/normalize.js';
import { verifyString } from '../crypto/packet-crypto.js';

const taxpayer = generateKeyPairSync('rsa', { modulusLength: 2048 });
const server = generateKeyPairSync('rsa', { modulusLength: 2048 });
const invoice = { header: { taxid: 'AA56CD0E0620002F2B4E78', tbill: 100 }, body: [], payments: [] };

const okSettings = (over: Partial<ClientSettingsView> = {}): ClientSettingsView => ({ fiscalId: 'AA56CD', environment: 'SANDBOX', sendingEnabled: true, verifiedAgainstSandboxAt: null, ...over });
const permit = (over: Partial<SendPermit> = {}): SendPermit => ({
  taxInvoiceId: 'ti1', status: 'QUEUED', approvedAt: new Date(), approvedByUserId: 'mgr', uid: '11111111-1111-4111-8111-111111111111', retry: false, invoice, expectedHash: hashNormalized(invoice), ...over,
});

describe('assertSendAllowed — the three hard rules', () => {
  it('refuses when sending is disabled', () => {
    expect(() => assertSendAllowed(okSettings({ sendingEnabled: false }), permit())).toThrowError(expect.objectContaining({ reason: 'SENDING_DISABLED' }));
  });

  it('refuses PRODUCTION without a sandbox verification, allows it once verified', () => {
    expect(() => assertSendAllowed(okSettings({ environment: 'PRODUCTION' }), permit())).toThrowError(expect.objectContaining({ reason: 'PRODUCTION_NOT_VERIFIED' }));
    expect(() => assertSendAllowed(okSettings({ environment: 'PRODUCTION', verifiedAgainstSandboxAt: new Date() }), permit())).not.toThrow();
  });

  it.each(['DRAFT', 'PENDING_APPROVAL', 'SENT', 'ACCEPTED', 'REJECTED', 'FAILED', 'CANCELLED'] as const)('refuses status %s', (status) => {
    expect(() => assertSendAllowed(okSettings(), permit({ status }))).toThrowError(expect.objectContaining({ reason: 'NOT_APPROVED' }));
  });

  it('refuses without approvedAt/approvedBy or when the payload changed after approval', () => {
    expect(() => assertSendAllowed(okSettings(), permit({ approvedAt: null }))).toThrow(SendRefusedError);
    expect(() => assertSendAllowed(okSettings(), permit({ approvedByUserId: null }))).toThrow(SendRefusedError);
    expect(() => assertSendAllowed(okSettings(), permit({ invoice: { ...invoice, header: { ...invoice.header, tbill: 999 } } }))).toThrowError(expect.objectContaining({ reason: 'PAYLOAD_CHANGED' }));
    expect(() => assertSendAllowed(okSettings(), permit({ expectedHash: null }))).toThrow(SendRefusedError);
  });
});

describe('base URL allow-list', () => {
  it('accepts only https on tax.gov.ir', () => {
    expect(() => assertAllowedBaseUrl('https://tp.tax.gov.ir/req/api/self-tsp/')).not.toThrow();
    expect(() => assertAllowedBaseUrl('https://sandbox.tax.gov.ir/x/')).not.toThrow();
    for (const bad of ['http://tp.tax.gov.ir/', 'https://evil.example.com/', 'https://tax.gov.ir.evil.com/', 'nonsense']) {
      expect(() => assertAllowedBaseUrl(bad)).toThrow(SendRefusedError);
    }
  });
});

function makeHttp(opts: { settings?: Partial<ClientSettingsView>; fetchImpl: any; logs?: ClientLogEntry[]; withKeys?: boolean }) {
  const cfg: MoodianClientConfig = {
    settings: okSettings(opts.settings),
    baseUrl: 'https://sandbox.tax.gov.ir/req/api/self-tsp/',
    privateKey: opts.withKeys === false ? null : taxpayer.privateKey,
    serverPublicKey: opts.withKeys === false ? null : server.publicKey,
    serverPublicKeyId: 'srv-key-1',
    onLog: (e) => opts.logs?.push(e),
  };
  let n = 0;
  return new HttpMoodianClient(cfg, { fetchImpl: opts.fetchImpl, now: () => 1_700_000_000_000, uuid: () => `trace-${++n}` });
}

const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });

describe('HttpMoodianClient (mocked fetch — no network)', () => {
  it('never calls fetch when the guard refuses', async () => {
    const fetchImpl = vi.fn();
    for (const [settings, p] of [
      [{ sendingEnabled: false }, permit()],
      [{ environment: 'PRODUCTION' as const }, permit()],
      [{}, permit({ status: 'DRAFT' })],
    ] as const) {
      await expect(makeHttp({ settings, fetchImpl }).sendInvoice(p)).rejects.toBeInstanceOf(SendRefusedError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gets a token, sends one encrypted+signed packet with uid/retry/headers per the doc, and logs no secrets', async () => {
    const logs: ClientLogEntry[] = [];
    const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, body });
      if (url.endsWith('sync/GET_TOKEN')) return json(200, { result: { data: { token: 'SECRET.TOKEN.VALUE', expiresIn: 1_700_000_900_000 } } });
      return json(200, { result: [{ uid: permit().uid, referenceNumber: 'ref-1', errorCode: null, errorDetail: null }] });
    });
    const res = await makeHttp({ fetchImpl, logs }).sendInvoice(permit({ retry: true }));
    expect(res).toEqual({ uid: permit().uid, referenceNumber: 'ref-1', errorCode: null, errorDetail: null });

    const send = calls.find((c) => c.url.endsWith('async/normal-enqueue'))!;
    expect(send.url).toBe('https://sandbox.tax.gov.ir/req/api/self-tsp/async/normal-enqueue');
    expect(send.headers.Authorization).toBe('Bearer SECRET.TOKEN.VALUE');
    expect(send.headers.requestTraceId).toMatch(/^trace-/);
    expect(send.headers.timestamp).toBe('1700000000000');
    const pkt = send.body.packets[0];
    expect(pkt).toMatchObject({ uid: permit().uid, packetType: 'INVOICE.V01', retry: true, encryptionKeyId: 'srv-key-1', fiscalId: 'AA56CD' });
    expect(typeof send.body.signature).toBe('string');
    // سمت سرور: بسته باز می‌شود و امضای داده با کلید عمومی مودی تأیید می‌شود
    const back = decryptInvoicePacket(pkt, server.privateKey);
    expect(back).toEqual(invoice);
    expect(verifyString(normalizeJson(back), pkt.dataSignature, taxpayer.publicKey)).toBe(true);
    // امضای درخواست: normalize(packets + سرآیندهای امضاشده)
    expect(verifyString(normalizeJson([pkt], { requestTraceId: send.headers.requestTraceId, timestamp: 1_700_000_000_000 }), send.body.signature, taxpayer.publicKey)).toBe(true);

    const dump = JSON.stringify(logs);
    for (const secret of ['SECRET.TOKEN.VALUE', pkt.symmetricKey, pkt.dataSignature, pkt.data, 'Bearer']) expect(dump).not.toContain(secret);
    expect(logs.some((l) => l.kind === 'SEND' && l.ok)).toBe(true);
  });

  it('surfaces a transport-level errors[] response as an errorCode result (no throw)', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('GET_TOKEN') ? json(200, { result: { data: { token: 't', expiresIn: 600 } } }) : json(200, { errors: [{ errorCode: '5013', errorDetail: 'invalid.packet.signature' }] }),
    );
    const r = await makeHttp({ fetchImpl }).sendInvoice(permit());
    expect(r.errorCode).toBe('5013');
    expect(r.referenceNumber).toBeNull();
  });

  it('network failure is a transient MoodianTransportError (single attempt for send)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('GET_TOKEN')) return json(200, { result: { data: { token: 't', expiresIn: 600 } } });
      throw new Error('ECONNRESET');
    });
    await expect(makeHttp({ fetchImpl }).sendInvoice(permit())).rejects.toMatchObject({ transient: true });
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith('normal-enqueue'))).toHaveLength(1);
  });

  it('inquiry retries transient failures with a fresh traceId, then succeeds', async () => {
    let inquiryCalls = 0;
    const traces: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init: any) => {
      if (url.endsWith('GET_TOKEN')) return json(200, { result: { data: { token: 't', expiresIn: 600 } } });
      traces.push(init.headers.requestTraceId);
      inquiryCalls += 1;
      if (inquiryCalls === 1) throw new Error('timeout');
      return json(200, { result: { data: [{ uid: 'u1', referenceNumber: 'r1', status: 'SUCCESS' }] } });
    });
    const items = await makeHttp({ fetchImpl }).inquiryByUid(['u1']);
    expect(items[0]!.status).toBe('SUCCESS');
    expect(new Set(traces).size).toBe(2);
  });

  it('refuses when keys are missing (NOT_CONFIGURED) before any network call', async () => {
    const fetchImpl = vi.fn();
    await expect(makeHttp({ fetchImpl, withKeys: false }).sendInvoice(permit())).rejects.toMatchObject({ reason: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('non-JSON response → transport error', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 502, text: async () => '<html>bad gateway</html>' }));
    await expect(makeHttp({ fetchImpl }).getServerInformation()).rejects.toBeInstanceOf(MoodianTransportError);
  });
});

describe('FakeMoodianClient', () => {
  it('applies the same guard and supports plan()', async () => {
    const fake = new FakeMoodianClient(okSettings({ sendingEnabled: false }));
    await expect(fake.sendInvoice(permit())).rejects.toBeInstanceOf(SendRefusedError);
    const fake2 = new FakeMoodianClient(okSettings());
    const r = await fake2.sendInvoice(permit());
    expect(r.referenceNumber).toBeTruthy();
    expect((await fake2.inquiryByUid([permit().uid]))[0]!.status).toBe('SUCCESS');
  });
});
