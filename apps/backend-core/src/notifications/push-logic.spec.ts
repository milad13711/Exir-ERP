import { describe, expect, it } from 'vitest';
import {
  ACK_DOMAIN,
  ACK_TTL_SEC,
  MAX_CONSECUTIVE_FAILURES,
  ROTATE_DOMAIN,
  SlidingRateLimiter,
  buildPushPayload,
  categoryForType,
  classifyPushError,
  deriveKey,
  deviceLabelFromUserAgent,
  inQuietHours,
  isAllowedPushEndpoint,
  isCriticalType,
  claimKey,
  smsDailyCap,
  smsText,
  tehranDateKey,
  ROTATE_TTL_SEC,
  parseHHmm,
  planDelivery,
  pushTiming,
  pushTopic,
  reasonCountsAsFailure,
  safeInternalPath,
  sanitizeCategoryPrefs,
  shouldDeleteAfterFailure,
  shouldSmsFallback,
  signAckToken,
  signRotateToken,
  tehranMinutes,
  verifyAckToken,
  verifyRotateToken,
} from './push-logic.js';

const KEY = deriveKey('master-secret-for-tests', ACK_DOMAIN);

describe('categories', () => {
  it('maps type prefixes to categories', () => {
    expect(categoryForType('task.assigned')).toBe('tasks');
    expect(categoryForType('reminder.alarm')).toBe('reminders');
    expect(categoryForType('correspondence.sign')).toBe('correspondence');
    expect(categoryForType('APPROVAL_REQUEST')).toBe('approvals');
    expect(categoryForType('messenger.message')).toBe('messenger');
    expect(categoryForType('marketing.campaign')).toBe('marketing');
    expect(categoryForType('billing.invoice')).toBe('system');
  });
  it('flags alarms and security as critical; explicit flag wins', () => {
    expect(isCriticalType('reminder.alarm')).toBe(true);
    expect(isCriticalType('security.login')).toBe(true);
    expect(isCriticalType('task.assigned')).toBe(false);
    expect(isCriticalType('reminder.alarm', false)).toBe(false); // پیش‌هشدار
    expect(isCriticalType('task.assigned', true)).toBe(true);
  });
});

describe('quiet hours', () => {
  it('parses HH:mm', () => {
    expect(parseHHmm('22:00')).toBe(1320);
    expect(parseHHmm('7:05')).toBe(425);
    expect(parseHHmm('25:00')).toBeNull();
    expect(parseHHmm('abc')).toBeNull();
  });
  it('handles windows crossing midnight and same-day windows', () => {
    expect(inQuietHours(23 * 60, '22:00', '07:00')).toBe(true);
    expect(inQuietHours(3 * 60, '22:00', '07:00')).toBe(true);
    expect(inQuietHours(7 * 60, '22:00', '07:00')).toBe(false); // انتهای بازه مستثناست
    expect(inQuietHours(12 * 60, '22:00', '07:00')).toBe(false);
    expect(inQuietHours(13 * 60, '12:00', '14:00')).toBe(true);
    expect(inQuietHours(15 * 60, '12:00', '14:00')).toBe(false);
    expect(inQuietHours(600, '10:00', '10:00')).toBe(false); // بازه‌ی تهی = خاموش
    expect(inQuietHours(600, 'x', '10:00')).toBe(false);
  });
  it('converts to Tehran wall-clock (UTC+3:30, no DST since 2022)', () => {
    expect(tehranMinutes(new Date('2026-10-24T20:30:00Z'))).toBe(0); // 00:00 تهران
    expect(tehranMinutes(new Date('2026-10-24T08:30:00Z'))).toBe(12 * 60);
  });
});

describe('planDelivery decision matrix', () => {
  const night = new Date('2026-10-24T20:00:00Z'); // 23:30 تهران
  const noon = new Date('2026-10-24T08:30:00Z'); // 12:00 تهران
  const quiet = { quietHoursEnabled: true, quietStart: '22:00', quietEnd: '07:00' };

  it('defaults: push+in-app on, sms off; marketing push off', () => {
    expect(planDelivery(null, { category: 'tasks', critical: false, now: noon })).toEqual({ inApp: true, push: true, sms: false, quiet: false });
    expect(planDelivery(null, { category: 'marketing', critical: false, now: noon }).push).toBe(false);
  });
  it('respects per-category channel toggles', () => {
    const prefs = { categoryPrefs: { tasks: { push: false, inApp: false, sms: true } } };
    expect(planDelivery(prefs, { category: 'tasks', critical: false, now: noon })).toMatchObject({ push: false, inApp: false, sms: true });
    expect(planDelivery(prefs, { category: 'messenger', critical: false, now: noon })).toMatchObject({ push: true, inApp: true, sms: false });
  });
  it('global smsEnabled is the default for categories without an override', () => {
    expect(planDelivery({ smsEnabled: true }, { category: 'tasks', critical: false, now: noon }).sms).toBe(true);
  });
  it('quiet hours suppress push+sms but keep in-app', () => {
    const p = planDelivery({ ...quiet, smsEnabled: true }, { category: 'tasks', critical: false, now: night });
    expect(p).toEqual({ inApp: true, push: false, sms: false, quiet: true });
  });
  it('critical bypasses quiet hours and in-app opt-out, but not an explicit push opt-out', () => {
    const p = planDelivery({ ...quiet, categoryPrefs: { reminders: { inApp: false } } }, { category: 'reminders', critical: true, now: night });
    expect(p).toMatchObject({ inApp: true, push: true, quiet: true });
    const off = planDelivery({ ...quiet, categoryPrefs: { reminders: { push: false } } }, { category: 'reminders', critical: true, now: night });
    expect(off.push).toBe(false);
  });
  it('explicit channels override category prefs (calendar reminder)', () => {
    const p = planDelivery({ categoryPrefs: { reminders: { push: false } } }, { category: 'reminders', critical: true, now: noon, channels: { push: true, sms: false } });
    expect(p).toMatchObject({ push: true, sms: false });
    expect(planDelivery(null, { category: 'reminders', critical: true, now: noon, channels: { push: false } }).push).toBe(false);
  });
  it('outside the quiet window nothing is suppressed', () => {
    expect(planDelivery(quiet, { category: 'tasks', critical: false, now: noon }).push).toBe(true);
  });
  it('sanitizes garbage category prefs', () => {
    expect(sanitizeCategoryPrefs({ tasks: { push: 'yes', sms: true }, bogus: { push: true }, system: 5 })).toEqual({ tasks: { sms: true } });
    expect(sanitizeCategoryPrefs(null)).toEqual({});
  });
});

describe('urgency / TTL', () => {
  it('alarms: high urgency, short TTL', () => {
    expect(pushTiming('reminders', true)).toEqual({ urgency: 'high', ttl: 600 });
  });
  it('maps categories', () => {
    expect(pushTiming('reminders', false).urgency).toBe('high');
    expect(pushTiming('messenger', false)).toEqual({ urgency: 'normal', ttl: 86400 });
    expect(pushTiming('marketing', false).urgency).toBe('low');
    expect(pushTiming('tasks', false).urgency).toBe('normal');
  });
  it('topic is url-safe and <=32 chars; absent without tag', () => {
    const t = pushTopic('messenger-1234');
    expect(t).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(pushTopic(undefined)).toBeUndefined();
  });
});

describe('payload building', () => {
  it('builds a compact valid JSON with defaults', () => {
    const { data, json } = buildPushPayload({ title: 'سلام', body: 'متن', url: '/tasks?open=1', category: 'tasks', ackToken: 'tok' });
    expect(JSON.parse(json)).toMatchObject({ v: 1, title: 'سلام', url: '/tasks?open=1', ackToken: 'tok', category: 'tasks' });
    expect(data.tag).toBeUndefined();
  });
  it('never exceeds ~4KB even with a huge Persian body', () => {
    const { json } = buildPushPayload({ title: 'ت'.repeat(500), body: 'پیام طولانی '.repeat(2000), url: '/x', ackToken: 'a'.repeat(300) });
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(3800);
    expect(JSON.parse(json).title.length).toBeLessThanOrEqual(120);
  });
  it('rejects open-redirect style urls', () => {
    expect(safeInternalPath('//evil.com')).toBe('/dashboard');
    expect(safeInternalPath('https://evil.com')).toBe('/dashboard');
    expect(safeInternalPath('/\\evil')).toBe('/dashboard');
    expect(safeInternalPath('/messenger?c=1')).toBe('/messenger?c=1');
    expect(JSON.parse(buildPushPayload({ title: 't', url: 'javascript:alert(1)' }).json).url).toBe('/dashboard');
    expect(safeInternalPath('/\t/evil.com')).toBe('/dashboard'); // کاراکتر کنترلی
    expect(safeInternalPath('/a\nb')).toBe('/dashboard');
    expect(safeInternalPath('/' + 'a'.repeat(2000))).toBe('/dashboard');
  });
  it('limits actions to 2 and keeps tag/renotify flags', () => {
    const { data } = buildPushPayload({
      title: 't',
      tag: 'reminder-1',
      renotify: true,
      requireInteraction: true,
      actions: [
        { action: 'a', title: '1' },
        { action: 'b', title: '2' },
        { action: 'c', title: '3' },
      ],
    });
    expect((data.actions as unknown[]).length).toBe(2);
    expect(data).toMatchObject({ tag: 'reminder-1', renotify: true, requireInteraction: true });
  });
});

describe('ack / rotate tokens', () => {
  const claims = { n: 'notif-1', u: 'user-1', t: 'tenant_db' };
  const now = Date.UTC(2026, 9, 24);

  it('round-trips', () => {
    const tok = signAckToken(claims, KEY, now);
    expect(verifyAckToken(tok, KEY, now + 1000)).toMatchObject(claims);
  });
  it('expires after 7 days', () => {
    const tok = signAckToken(claims, KEY, now);
    expect(verifyAckToken(tok, KEY, now + (ACK_TTL_SEC - 5) * 1000)).not.toBeNull();
    expect(verifyAckToken(tok, KEY, now + (ACK_TTL_SEC + 5) * 1000)).toBeNull();
  });
  it('rejects tampering, wrong key and garbage', () => {
    const tok = signAckToken(claims, KEY, now);
    const [body, sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, u: 'victim', e: 9_999_999_999 })).toString('base64url');
    expect(verifyAckToken(`${forged}.${sig}`, KEY, now)).toBeNull();
    expect(verifyAckToken(`${body}.${sig.slice(0, -2)}AA`, KEY, now)).toBeNull();
    expect(verifyAckToken(tok, deriveKey('other', ACK_DOMAIN), now)).toBeNull();
    for (const bad of [undefined, null, 5, '', 'nodot', '.', 'a.b', 'x'.repeat(5000)]) expect(verifyAckToken(bad, KEY, now)).toBeNull();
  });
  it('domain separation: ack tokens are not valid rotate tokens and vice versa', () => {
    const master = 'master';
    const ack = deriveKey(master, ACK_DOMAIN);
    const rot = deriveKey(master, ROTATE_DOMAIN);
    expect(ack.equals(rot)).toBe(false);
    const a = signAckToken(claims, ack, now);
    expect(verifyAckToken(a, rot, now)).toBeNull();
    const r = signRotateToken({ s: 'sub1', u: 'user-1', t: 'tenant_db', k: 'nonce', v: 3 }, rot, now);
    expect(verifyRotateToken(r, rot, now)).toMatchObject({ s: 'sub1', k: 'nonce', v: 3 });
    expect(verifyRotateToken(r, ack, now)).toBeNull();
    // ack token بدون فیلد s معتبر rotate نیست
    expect(verifyRotateToken(signAckToken(claims, rot, now), rot, now)).toBeNull();
  });
});

describe('failure classification', () => {
  it('404/410 => expired + delete now', () => {
    for (const code of [404, 410]) {
      const k = classifyPushError({ statusCode: code });
      expect(k).toMatchObject({ status: 'expired', reason: 'expired', deleteNow: true });
      expect(shouldDeleteAfterFailure(k, 0)).toBe(true);
    }
  });
  it('401/403 count as failures but are not deleted immediately', () => {
    expect(classifyPushError({ statusCode: 401 })).toMatchObject({ reason: 'unauthorized', deleteNow: false, countsAsFailure: true });
    expect(classifyPushError({ statusCode: 403 })).toMatchObject({ reason: 'vapid_mismatch' });
  });
  it('413/429/5xx/network are transient (not counted)', () => {
    expect(classifyPushError({ statusCode: 413 }).reason).toBe('payload_too_large');
    expect(classifyPushError({ statusCode: 429 })).toMatchObject({ reason: 'rate_limited', countsAsFailure: false });
    expect(classifyPushError({ statusCode: 503 })).toMatchObject({ reason: 'push_service_error', countsAsFailure: false });
    expect(classifyPushError(new Error('Request timed out'))).toMatchObject({ reason: 'network', countsAsFailure: false });
    expect(reasonCountsAsFailure('network')).toBe(false);
    expect(reasonCountsAsFailure('vapid_mismatch')).toBe(true);
  });
  it('deletes after N consecutive counted failures only', () => {
    const k = classifyPushError({ statusCode: 401 });
    expect(shouldDeleteAfterFailure(k, MAX_CONSECUTIVE_FAILURES - 2)).toBe(false);
    expect(shouldDeleteAfterFailure(k, MAX_CONSECUTIVE_FAILURES - 1)).toBe(true);
    expect(shouldDeleteAfterFailure(classifyPushError({ statusCode: 503 }), 999)).toBe(false);
  });
});

describe('device label', () => {
  it('parses common browsers', () => {
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36')).toBe('Chrome روی Android');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36')).toBe('Samsung Internet روی Android');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1')).toBe('Safari روی iPhone');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toBe('Edge روی Windows');
    expect(deviceLabelFromUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0')).toBe('Firefox روی Linux');
    expect(deviceLabelFromUserAgent(undefined)).toBe('دستگاه ناشناس');
  });
});

describe('sms fallback gate', () => {
  const base = { enabled: true, important: true, pushOk: false, smsInLast24h: 0, lastSmsAt: null as Date | null, now: new Date('2026-10-24T10:00:00Z') };
  it('sends only for important notifications that failed to push, when enabled', () => {
    expect(shouldSmsFallback(base)).toBe(true);
    expect(shouldSmsFallback({ ...base, enabled: false })).toBe(false);
    expect(shouldSmsFallback({ ...base, important: false })).toBe(false);
    expect(shouldSmsFallback({ ...base, pushOk: true })).toBe(false);
  });
  it('daily cap and cooldown', () => {
    expect(shouldSmsFallback({ ...base, smsInLast24h: 3 })).toBe(false);
    expect(shouldSmsFallback({ ...base, lastSmsAt: new Date('2026-10-24T09:55:00Z') })).toBe(false);
    expect(shouldSmsFallback({ ...base, lastSmsAt: new Date('2026-10-24T09:40:00Z') })).toBe(true);
  });
});

describe('SlidingRateLimiter', () => {
  it('limits per key within the window and recovers', () => {
    const l = new SlidingRateLimiter(2, 1000);
    expect(l.allow('ip', 0)).toBe(true);
    expect(l.allow('ip', 10)).toBe(true);
    expect(l.allow('ip', 20)).toBe(false);
    expect(l.allow('other', 20)).toBe(true);
    expect(l.allow('ip', 1100)).toBe(true);
  });
});

describe('push endpoint allowlist (anti-SSRF)', () => {
  it('accepts real push services only on exact domains', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://us-east-1.push.services.mozilla.com/x',
      'https://web.push.apple.com/QAbc',
      'https://api.push.apple.com/3/device/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://db5p.notify.windows.com/x',
    ]) expect(isAllowedPushEndpoint(ok), ok).toBe(true);
  });
  it('rejects look-alikes, internal targets and odd URL forms', () => {
    for (const bad of [
      'http://fcm.googleapis.com/x', // http
      'https://fcm.googleapis.com.evil.com/x',
      'https://evil.com/fcm.googleapis.com',
      'https://evilfcm.googleapis.com.attacker.io/',
      'https://notify.windows.com.evil.com/',
      'https://push.apple.com/x', // باید زیردامنه باشد
      'https://127.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://localhost/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
      'https://internal.corp/x',
      'ftp://fcm.googleapis.com/x',
      '',
      'not a url',
      'https://' + 'a'.repeat(3000) + '.push.apple.com/',
    ]) expect(isAllowedPushEndpoint(bad), bad).toBe(false);
    expect(isAllowedPushEndpoint(undefined)).toBe(false);
    expect(isAllowedPushEndpoint(5)).toBe(false);
  });
});

describe('rotate token ttl', () => {
  it('is 45 days (sliding), not a year', () => {
    expect(ROTATE_TTL_SEC).toBe(45 * 24 * 3600);
    const key = deriveKey('m', ROTATE_DOMAIN);
    const now = Date.UTC(2026, 9, 24);
    const t = signRotateToken({ s: 's', u: 'u', t: 't', k: 'k', v: 0 }, key, now);
    expect(verifyRotateToken(t, key, now + 44 * 86400_000)).not.toBeNull();
    expect(verifyRotateToken(t, key, now + 46 * 86400_000)).toBeNull();
  });
});

describe('sms helpers', () => {
  it('uses a fixed template, strips links/control chars and clips the title', () => {
    const t = smsText('سلام http://evil.com/phish\u0007 ' + 'x'.repeat(200));
    expect(t.startsWith('اکسیر: ')).toBe(true);
    expect(t).not.toContain('http');
    expect(t).toContain('برای مشاهده وارد برنامه شوید');
    expect(t.length).toBeLessThan(120);
    expect(smsText('')).toContain('اعلان جدید');
  });
  it('daily cap env parsing and claim keys', () => {
    expect(smsDailyCap(undefined)).toBe(20);
    expect(smsDailyCap('5')).toBe(5);
    expect(smsDailyCap('-1')).toBe(20);
    expect(smsDailyCap('abc')).toBe(20);
    expect(claimKey('sms', 'u1', '2026-10-24', 3)).toBe('sms:u1:2026-10-24:3');
    expect(tehranDateKey(new Date('2026-10-24T21:00:00Z'))).toBe('2026-10-25'); // ۰۰:۳۰ بامداد تهران
  });
});
