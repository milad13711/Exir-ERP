import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExirSmsService } from './exir-sms.service.js';

describe('ExirSmsService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.EXIR_SMS_API_KEY = 'test-key';
    process.env.EXIR_SMS_SENDER_LINE = '3000123456';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('reports not configured when env vars are missing', async () => {
    delete process.env.EXIR_SMS_API_KEY;
    const sms = new ExirSmsService();
    expect(sms.isConfigured()).toBe(false);
    const result = await sms.sendSms('09121234567', 'test');
    expect(result.success).toBe(false);
  });

  it('sends the LimoSMS-shaped request body and succeeds on HTTP 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ IsSuccessful: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const sms = new ExirSmsService();
    const result = await sms.sendSms('09121234567', 'کد ورود شما: 1234');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.limosms.com/api/sendsms',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ ApiKey: 'test-key' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({
      Message: 'کد ورود شما: 1234',
      SenderNumber: '3000123456',
      MobileNumber: ['09121234567'],
    });
  });

  it('treats HTTP 200 with IsSuccessful:false as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ IsSuccessful: false, Message: 'اعتبار ناکافی است' }),
      }),
    );
    const sms = new ExirSmsService();
    const result = await sms.sendSms('09121234567', 'test');
    expect(result).toEqual({ success: false, error: 'اعتبار ناکافی است' });
  });

  it('treats a non-2xx HTTP status as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' }),
    );
    const sms = new ExirSmsService();
    const result = await sms.sendSms('09121234567', 'test');
    expect(result.success).toBe(false);
  });

  it('respects EXIR_SMS_API_BASE_URL override', async () => {
    process.env.EXIR_SMS_API_BASE_URL = 'https://api.exirsms.ir';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);

    const sms = new ExirSmsService();
    await sms.sendSms('09121234567', 'test');

    expect(fetchMock).toHaveBeenCalledWith('https://api.exirsms.ir/api/sendsms', expect.anything());
  });
});
