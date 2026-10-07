import { describe, expect, it } from 'vitest';
import { maskIp, maskPhone, redactSmsPreview, smsPartCount } from './activity-redact.util.js';

describe('activity redaction', () => {
  it('masks phones and ips', () => {
    expect(maskPhone('09123456789')).toBe('0912•••789');
    expect(maskPhone('1')).toBe('•••');
    expect(maskIp('203.0.113.77')).toBe('203.0.113.x');
    expect(maskIp('::ffff:10.1.2.3')).toBe('10.1.2.x');
    expect(maskIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::');
    expect(maskIp(undefined)).toBeNull();
  });
  it('drops previews for OTP-like messages and truncates others', () => {
    expect(redactSmsPreview('کد تایید شما: 5566')).toBeNull();
    expect(redactSmsPreview('Your OTP is 123456')).toBeNull();
    const p = redactSmsPreview('سلام '.repeat(40));
    expect(p!.length).toBeLessThanOrEqual(61);
  });
  it('counts sms parts', () => {
    expect(smsPartCount('سلام')).toBe(1);
    expect(smsPartCount('ا'.repeat(71))).toBe(2);
    expect(smsPartCount('a'.repeat(161))).toBe(2);
  });
});
