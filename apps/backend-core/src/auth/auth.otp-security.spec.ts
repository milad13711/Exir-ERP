import { describe, expect, it, vi } from 'vitest';
import { AuthService, generateOtpCode, loginOtpDigits } from './auth.service.js';

function make(opts: { smsConfigured?: boolean; smsOk?: boolean; rows?: Array<{ createdAt: Date; purpose: string }>; globalCount?: number; attempts?: { h: number; d: number }; otp?: unknown } = {}) {
  const otpCode = {
    findMany: vi.fn().mockResolvedValue(opts.rows ?? []),
    count: vi.fn().mockResolvedValue(opts.globalCount ?? 0),
    create: vi.fn().mockResolvedValue({}),
    findFirst: vi.fn().mockResolvedValue(opts.otp ?? null),
    update: vi.fn().mockResolvedValue({}),
    aggregate: vi.fn().mockImplementation(({ where }: { where: { createdAt: { gte: Date } } }) => {
      const isHour = Date.now() - where.createdAt.gte.getTime() < 2 * 3600_000;
      return Promise.resolve({ _sum: { attempts: isHour ? (opts.attempts?.h ?? 0) : (opts.attempts?.d ?? 0) } });
    }),
  };
  const controlDb = { otpCode, errorLog: { create: vi.fn().mockResolvedValue({}) } };
  const sms = { isConfigured: () => opts.smsConfigured ?? false, sendSms: vi.fn().mockResolvedValue({ success: opts.smsOk ?? true, error: 'down' }) };
  const events = { record: vi.fn() };
  const svc = new AuthService(controlDb as never, {} as never, {} as never, sms as never, events as never, { effective: vi.fn() } as never, {} as never);
  return { svc, otpCode, sms, events, controlDb };
}

describe('OTP code generation', () => {
  it('uses a CSPRNG-backed generator: right length, digits only, no leading zero, wide spread', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generateOtpCode(4);
      expect(c).toMatch(/^[1-9]\d{3}$/);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(1200);
    expect(generateOtpCode(6)).toMatch(/^[1-9]\d{5}$/);
  });

  it('LOGIN_OTP_DIGITS=6 switches the login code length, default stays 4', () => {
    expect(loginOtpDigits()).toBe(4);
    process.env.LOGIN_OTP_DIGITS = '6';
    expect(loginOtpDigits()).toBe(6);
    delete process.env.LOGIN_OTP_DIGITS;
  });
});

describe('AuthService.requestOtp — abuse limits', () => {
  it('enforces a per-phone cooldown', async () => {
    const { svc, otpCode } = make({ rows: [{ createdAt: new Date(Date.now() - 5_000), purpose: 'LOGIN' }] });
    await expect(svc.requestOtp('09121234567')).rejects.toMatchObject({ status: 429 });
    expect(otpCode.create).not.toHaveBeenCalled();
  });

  it('caps requests per phone: 5 per 15 minutes across all purposes', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ createdAt: new Date(Date.now() - (60 + i * 60) * 1000), purpose: 'BOOKING' }));
    const { svc, events } = make({ rows });
    await expect(svc.requestOtp('09121234567', 'LOGIN')).rejects.toMatchObject({ status: 429 });
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'OTP_LOCKED' }));
  });

  it('caps requests per phone per 24h', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ createdAt: new Date(Date.now() - (2 + i) * 3600_000 / 2), purpose: 'LOGIN' }));
    const { svc } = make({ rows });
    await expect(svc.requestOtp('09121234567')).rejects.toMatchObject({ status: 429 });
  });

  it('global daily cap stops SMS pumping and raises a FATAL security event', async () => {
    process.env.OTP_GLOBAL_DAILY_CAP = '100';
    const { svc, events } = make({ globalCount: 100 });
    await expect(svc.requestOtp('09121234567')).rejects.toMatchObject({ status: 429 });
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'OTP_CAP_REACHED', severity: 'FATAL' }));
    delete process.env.OTP_GLOBAL_DAILY_CAP;
  });

  it('normal request: stores only a hash, reports codeLength, sends SMS', async () => {
    const { svc, otpCode, sms } = make({ smsConfigured: true });
    const res = await svc.requestOtp('09121234567');
    expect(res.codeLength).toBe(4);
    expect(res).not.toHaveProperty('devCode');
    const stored = otpCode.create.mock.calls[0][0].data;
    expect(stored.codeHash).toMatch(/^\$2[aby]\$/);
    expect(sms.sendSms).toHaveBeenCalled();
  });
});

describe('AuthService.requestOtp — devCode echo cannot be abused', () => {
  it('OTP_DEV_ECHO never leaks the code when SMS is configured but the provider failed (account-takeover vector)', async () => {
    process.env.OTP_DEV_ECHO = 'true';
    const { svc } = make({ smsConfigured: true, smsOk: false });
    const res = await svc.requestOtp('09121234567');
    expect(res).not.toHaveProperty('devCode');
    delete process.env.OTP_DEV_ECHO;
  });

  it('still echoes in dev / on-premise where SMS is not configured at all', async () => {
    process.env.OTP_DEV_ECHO = 'true';
    const { svc } = make({ smsConfigured: false });
    const res = await svc.requestOtp('09121234567');
    expect(res.devCode).toMatch(/^\d{4}$/);
    delete process.env.OTP_DEV_ECHO;
  });

  it('error logs carry a masked phone, not the full number', async () => {
    const { svc, controlDb } = make({ smsConfigured: true, smsOk: false });
    await svc.requestOtp('09121234567');
    const ctx = controlDb.errorLog.create.mock.calls[0][0].data.context;
    expect(ctx.phone).toBe('0912***567');
  });
});

describe('AuthService.verifyOtp — brute-force lockout (4-digit codes)', () => {
  it('locks the phone after 10 wrong guesses in an hour even if a fresh code was requested', async () => {
    const { svc, events } = make({ attempts: { h: 10, d: 10 } });
    await expect(svc.verifyOtp('09121234567', '1234')).rejects.toMatchObject({ status: 429 });
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'OTP_LOCKED' }));
  });

  it('locks after 20 wrong guesses in a day', async () => {
    const { svc } = make({ attempts: { h: 2, d: 20 } });
    await expect(svc.verifyOtp('09121234567', '1234')).rejects.toMatchObject({ status: 429 });
  });

  it('a wrong code increments attempts and logs a security event', async () => {
    const otp = { id: 'o1', attempts: 0, codeHash: '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali' };
    const { svc, otpCode, events } = make({ otp });
    await expect(svc.verifyOtp('09121234567', '1234')).rejects.toMatchObject({ status: 401 });
    expect(otpCode.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { attempts: { increment: 1 } } });
    expect(events.record).toHaveBeenCalledWith(expect.objectContaining({ type: 'LOGIN_FAILED' }));
  });
});
