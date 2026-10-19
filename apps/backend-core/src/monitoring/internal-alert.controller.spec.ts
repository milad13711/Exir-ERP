import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InternalAlertController } from './internal-alert.controller.js';

const TOKEN = 'a'.repeat(40);
const req = (o: { ip?: string; headers?: Record<string, string> } = {}) =>
  ({ socket: { remoteAddress: o.ip ?? '127.0.0.1' }, headers: { 'x-internal-alert-token': TOKEN, ...(o.headers ?? {}) } }) as any;

let notify: ReturnType<typeof vi.fn>;
let startM: ReturnType<typeof vi.fn>;
let clearM: ReturnType<typeof vi.fn>;
let heartbeat: ReturnType<typeof vi.fn>;
let ctl: InternalAlertController;
beforeEach(() => {
  process.env.INTERNAL_ALERT_TOKEN = TOKEN;
  notify = vi.fn(async () => ({ sent: true }));
  heartbeat = vi.fn(async () => {});
  startM = vi.fn(async () => ({ until: '2026-01-01T00:00:00.000Z' }));
  clearM = vi.fn(async () => ({ wasActive: true }));
  ctl = new InternalAlertController({ notify, recordHostHeartbeat: heartbeat, startMaintenance: startM, clearMaintenance: clearM } as any);
});
afterEach(() => {
  delete process.env.INTERNAL_ALERT_TOKEN;
  delete process.env.INTERNAL_ALERT_RATE_PER_10MIN;
});

describe('POST /internal/alert', () => {
  it('accepts loopback + correct token and forwards with host: prefix', async () => {
    await expect(ctl.alert(req(), { kind: 'ssh-login', message: 'new ip' })).resolves.toMatchObject({ ok: true, sent: true });
    expect(notify).toHaveBeenCalledWith('host:ssh-login', 'new ip', { source: 'host', resolved: false });
  });
  it('accepts a docker-network peer (172.18.x) without proxy headers', async () => {
    await expect(ctl.alert(req({ ip: '172.18.0.1' }), { kind: 'k', message: 'm' })).resolves.toMatchObject({ ok: true });
  });
  it('is disabled (404) when the token env is unset or weak', async () => {
    delete process.env.INTERNAL_ALERT_TOKEN;
    await expect(ctl.alert(req(), { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(NotFoundException);
    process.env.INTERNAL_ALERT_TOKEN = 'short';
    await expect(ctl.alert(req(), { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects missing and wrong token (401)', async () => {
    await expect(ctl.alert(req({ headers: { 'x-internal-alert-token': '' } }), { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.alert(req({ headers: { 'x-internal-alert-token': 'b'.repeat(40) } }), { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(UnauthorizedException);
    const noHeader = { socket: { remoteAddress: '127.0.0.1' }, headers: {} } as any;
    await expect(ctl.alert(noHeader, { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(notify).not.toHaveBeenCalled();
  });
  it('rejects public peers even with the right token (403)', async () => {
    await expect(ctl.alert(req({ ip: '203.0.113.9' }), { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects requests that came through the reverse proxy (X-Real-IP / X-Forwarded-For present)', async () => {
    await expect(ctl.alert(req({ headers: { 'x-real-ip': '198.51.100.7' } }), { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.alert(req({ headers: { 'x-forwarded-for': '198.51.100.7' } }), { kind: 'k', message: 'm' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rate-limits (429)', async () => {
    process.env.INTERNAL_ALERT_RATE_PER_10MIN = '3';
    for (let i = 0; i < 3; i++) await ctl.alert(req(), { kind: 'k', message: 'm' });
    const err = await ctl.alert(req(), { kind: 'k', message: 'm' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
  });
  it('validates kind/message', async () => {
    await expect(ctl.alert(req(), { kind: 'bad kind!', message: 'm' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.alert(req(), { kind: 'ok', message: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.alert(req(), null)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('heartbeat records without sending SMS', async () => {
    await expect(ctl.alert(req(), { heartbeat: true })).resolves.toMatchObject({ heartbeat: true });
    expect(heartbeat).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it('resolved flag is forwarded for recovery notices', async () => {
    await ctl.alert(req(), { kind: 'nginx-5xx', message: 'back to normal', resolved: true });
    expect(notify).toHaveBeenCalledWith('host:nginx-5xx', 'back to normal', { source: 'host', resolved: true });
  });
});

describe('POST /internal/maintenance', () => {
  it('starts a window with validated minutes/reason', async () => {
    await expect(ctl.maintenance(req(), { minutes: 20, reason: 'deploy' })).resolves.toMatchObject({ ok: true, until: expect.any(String) });
    expect(startM).toHaveBeenCalledWith(20, 'deploy');
  });
  it('clear:true closes the window', async () => {
    await expect(ctl.maintenance(req(), { clear: true })).resolves.toMatchObject({ cleared: true, wasActive: true });
    expect(clearM).toHaveBeenCalled();
  });
  it('rejects out-of-range minutes (400)', async () => {
    await expect(ctl.maintenance(req(), { minutes: 500 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.maintenance(req(), {})).rejects.toBeInstanceOf(BadRequestException);
    expect(startM).not.toHaveBeenCalled();
  });
  it('shares the auth layers: 404 without token env, 401 wrong token, 403 public/proxied peer', async () => {
    await expect(ctl.maintenance(req({ headers: { 'x-internal-alert-token': 'b'.repeat(40) } }), { minutes: 5 })).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(ctl.maintenance(req({ ip: '203.0.113.9' }), { minutes: 5 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.maintenance(req({ headers: { 'x-real-ip': '1.2.3.4' } }), { minutes: 5 })).rejects.toBeInstanceOf(ForbiddenException);
    delete process.env.INTERNAL_ALERT_TOKEN;
    await expect(ctl.maintenance(req(), { minutes: 5 })).rejects.toBeInstanceOf(NotFoundException);
    expect(startM).not.toHaveBeenCalled();
  });
});
