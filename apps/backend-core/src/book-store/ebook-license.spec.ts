import { describe, expect, it } from 'vitest';
import { base32, licenceCode, maskPhone, normalizePhone, signDownload, verifyDownload, verifyLicenceCode } from './ebook-license.js';

describe('ebook licence code', () => {
  // بردارهای مرجع از خود license_stamp.py (FK_LICENSE_SECRET=test-secret) — اگر این تست شکست، کدهای چاپ‌شده روی نسخه‌ها دیگر تأیید نمی‌شوند.
  it('matches the Python stamping tool bit-for-bit', () => {
    expect(licenceCode('test-secret', 1024, '09121234567')).toBe('FK-TDWI-OQ5X-OJG7-3IMK');
    expect(licenceCode('test-secret', '7', '+98 912 765 4321')).toBe('FK-QNSJ-ONQL-KXW5-PDP5');
    expect(licenceCode('test-secret', 33, '۰۹۳۵۱۱۱۲۲۳۳')).toBe('FK-IYTJ-4SL3-IXMA-F4FY');
  });

  it('base32 matches RFC 4648 vectors', () => {
    expect(base32(Buffer.from('f'))).toBe('MY');
    expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('normalises phones the same way as the stamper', () => {
    expect(normalizePhone('+98 912-123-4567')).toBe('09121234567');
    expect(normalizePhone('۰۹۱۲۱۲۳۴۵۶۷')).toBe('09121234567');
    expect(normalizePhone('٠٩١٢١٢٣٤٥٦٧')).toBe('09121234567');
    expect(maskPhone('09121234567')).toBe('0912•••4567');
  });

  it('verifies tolerant of case, spacing and missing prefix', () => {
    expect(verifyLicenceCode('test-secret', 1024, '09121234567', 'FK-TDWI-OQ5X-OJG7-3IMK')).toBe(true);
    expect(verifyLicenceCode('test-secret', 1024, '09121234567', ' fk-tdwi oq5x-ojg7-3imk ')).toBe(true);
    expect(verifyLicenceCode('test-secret', 1024, '09121234567', 'TDWIOQ5XOJG73IMK')).toBe(true);
  });

  it('rejects wrong order, phone, secret or code', () => {
    expect(verifyLicenceCode('test-secret', 1025, '09121234567', 'FK-TDWI-OQ5X-OJG7-3IMK')).toBe(false);
    expect(verifyLicenceCode('test-secret', 1024, '09121234568', 'FK-TDWI-OQ5X-OJG7-3IMK')).toBe(false);
    expect(verifyLicenceCode('other', 1024, '09121234567', 'FK-TDWI-OQ5X-OJG7-3IMK')).toBe(false);
    expect(verifyLicenceCode('test-secret', 1024, '09121234567', 'FK-TDWI-OQ5X-OJG7-3IMA')).toBe(false);
    expect(verifyLicenceCode('test-secret', 1024, '09121234567', '')).toBe(false);
  });
});

describe('ebook download link signing', () => {
  const now = Date.UTC(2026, 9, 31);
  const id = '3f1c2b4a-0000-4000-8000-000000000001';

  it('accepts a fresh token for the same order', () => {
    const t = signDownload('k', id, 3600, now);
    expect(t.s).toHaveLength(22);
    expect(verifyDownload('k', id, t.e, t.s, now + 1000)).toBe('ok');
  });

  it('reports expiry separately from forgery', () => {
    const t = signDownload('k', id, 60, now);
    expect(verifyDownload('k', id, t.e, t.s, now + 61_000)).toBe('expired');
  });

  it('rejects another order, another secret, a tampered expiry or junk', () => {
    const t = signDownload('k', id, 3600, now);
    expect(verifyDownload('k', id.replace(/1$/, '2'), t.e, t.s, now)).toBe('invalid');
    expect(verifyDownload('k2', id, t.e, t.s, now)).toBe('invalid');
    expect(verifyDownload('k', id, (parseInt(t.e, 36) + 86400).toString(36), t.s, now)).toBe('invalid');
    expect(verifyDownload('k', id, undefined, t.s, now)).toBe('invalid');
    expect(verifyDownload('k', id, t.e, ['x'], now)).toBe('invalid');
  });
});
