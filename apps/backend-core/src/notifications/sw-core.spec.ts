import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { assessPushSupport, deniedRecoverySteps, detectPlatform, parseReminderAction, promptDelayMs, shouldShowPrompt, vapidKeyMatches, bytesToBase64Url, urlBase64ToUint8Array } from '../../../web-panel/src/lib/push-client-pure.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Core = require('../../../web-panel/public/sw-core.js');
const O = 'https://erp.example.com';
const req = (path: string, extra: Record<string, unknown> = {}) => ({ method: 'GET', url: O + path, mode: 'cors', ...extra });

describe('sw-core classifyRequest', () => {
  it('never touches API, data, non-GET, cross-origin or range requests', () => {
    expect(Core.classifyRequest(req('/api/tasks'), O)).toBe('skip');
    expect(Core.classifyRequest(req('/_next/data/x/y.json'), O)).toBe('skip');
    expect(Core.classifyRequest({ ...req('/a'), method: 'POST' }, O)).toBe('skip');
    expect(Core.classifyRequest({ ...req('/x.js'), url: 'https://cdn.other.com/x.js' }, O)).toBe('skip');
    expect(Core.classifyRequest(req('/media/a.mp3', { hasRange: true }), O)).toBe('skip');
    expect(Core.classifyRequest(req('/sw.js'), O)).toBe('skip');
    expect(Core.classifyRequest(req('/manifest.webmanifest'), O)).toBe('skip');
  });
  it('caches only hashed immutable assets cache-first (dev chunk names are never cached)', () => {
    expect(Core.classifyRequest(req('/_next/static/chunks/0a1b2c3d4e5f6a7b.js'), O)).toBe('immutable');
    expect(Core.classifyRequest(req('/_next/static/css/app-1234abcd5678.css'), O)).toBe('immutable');
    expect(Core.classifyRequest(req('/_next/static/chunks/main-app.js'), O)).toBe('skip');
    expect(Core.classifyRequest(req('/_next/static/chunks/_abc._.js'), O)).toBe('skip');
  });
  it('navigations are network-only with offline fallback; icons are SWR', () => {
    expect(Core.classifyRequest(req('/dashboard', { mode: 'navigate' }), O)).toBe('navigate');
    expect(Core.classifyRequest(req('/icons/icon-192.png'), O)).toBe('static');
  });
  it('old versioned shell caches are deleted but immutable/meta caches survive', () => {
    expect(Core.cachesToDelete(['exir-shell-v2', Core.SHELL_CACHE, Core.IMMUTABLE_CACHE, Core.META_CACHE, 'exir-api-v1'])).toEqual(['exir-shell-v2', 'exir-api-v1']);
  });
});

describe('sw-core push payload', () => {
  it('parses safely and applies defaults', () => {
    expect(Core.parsePushPayload('not json')).toMatchObject({ title: 'اکسیر ERP', body: 'not json', url: '/dashboard' });
    expect(Core.parsePushPayload(null)).toMatchObject({ title: 'اکسیر ERP', icon: '/icons/icon-192.png' });
    expect(Core.parsePushPayload({ json: () => { throw new Error('x'); }, text: () => 'raw' })).toMatchObject({ body: 'raw' });
    expect(Core.parsePushPayload('{"title":"t","url":"//evil.com","icon":"https://evil/x.png"}')).toMatchObject({ url: '/dashboard', icon: '/icons/icon-192.png' });
  });
  it('builds options: renotify only with tag, requireInteraction for alarms, max 2 actions', () => {
    const p = Core.parsePushPayload({ title: 'آلارم', tag: 'reminder-1', renotify: true, requireInteraction: true, actions: [{ action: 'done', title: 'انجام شد' }, { action: 'snooze', title: '۱۰' }, { action: 'x', title: 'y' }] });
    const { options } = Core.buildNotificationOptions(p, 1);
    expect(options).toMatchObject({ tag: 'reminder-1', renotify: true, requireInteraction: true, dir: 'rtl', lang: 'fa' });
    expect(options.actions).toHaveLength(2);
    const noTag = Core.buildNotificationOptions(Core.parsePushPayload({ title: 't', renotify: true }), 1).options;
    expect(noTag.renotify).toBeUndefined();
  });
  it('skips the system notification only on focused Chromium with silentIfVisible (never WebKit/Firefox/alarms)', () => {
    const chrome = 'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36';
    const win = [{ visibilityState: 'visible', focused: true }];
    const p = Core.parsePushPayload({ title: 't', silentIfVisible: true });
    expect(Core.shouldSkipSystemNotification(p, win, chrome)).toBe(true);
    expect(Core.shouldSkipSystemNotification(p, [{ visibilityState: 'hidden', focused: false }], chrome)).toBe(false);
    expect(Core.shouldSkipSystemNotification(p, win, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Safari/604.1')).toBe(false);
    expect(Core.shouldSkipSystemNotification(p, win, 'Mozilla/5.0 Firefox/127.0')).toBe(false);
    expect(Core.shouldSkipSystemNotification(Core.parsePushPayload({ title: 't', silentIfVisible: true, requireInteraction: true }), win, chrome)).toBe(false);
  });
  it('builds the ack request from ?api= base', () => {
    expect(Core.apiBaseFromSearch('?api=%2Fapi', O)).toBe(O + '/api');
    expect(Core.apiBaseFromSearch('?api=javascript:alert(1)', O)).toBe(O + '/api');
    expect(Core.apiBaseFromSearch('', O)).toBe(O + '/api');
    expect(Core.buildAckRequest(Core.parsePushPayload({ title: 't', ackToken: 'a.b' }), O + '/api')).toEqual({ url: O + '/api/push/ack', body: '{"t":"a.b"}' });
    expect(Core.buildAckRequest(Core.parsePushPayload({ title: 't' }), O + '/api')).toBeNull();
  });
});

describe('sw-core click targets', () => {
  it('messenger deep link + reply action focuses composer', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const t = Core.resolveClickTarget({ url: `/messenger?c=${id}` }, 'reply');
    expect(t.url).toBe(`/messenger?c=${id}&focus=1`);
    expect(t.message).toEqual({ type: 'messenger-open', conversationId: id, focus: true });
  });
  it('reminder actions open the app with act param (SW has no auth)', () => {
    const t = Core.resolveClickTarget({ url: '/dashboard?reminder=r1', entityType: 'reminder', entityId: 'r1' }, 'snooze');
    expect(t.url).toBe('/dashboard?reminder=r1&act=snooze');
    expect(t.message).toEqual({ type: 'reminder-action', id: 'r1', act: 'snooze' });
    expect(Core.resolveClickTarget({ url: '/dashboard?reminder=r1', entityType: 'reminder', entityId: 'r1' }, '').url).toBe('/dashboard?reminder=r1');
  });
  it('tasks/correspondence links pass through; external urls are neutralised', () => {
    expect(Core.resolveClickTarget({ url: '/tasks?open=abc' }, '').url).toBe('/tasks?open=abc');
    expect(Core.resolveClickTarget({ url: 'https://evil.com' }, '').url).toBe('/dashboard');
    expect(Core.resolveClickTarget({ url: '/\t/evil.com' }, '').url).toBe('/dashboard');
    expect(Core.resolveClickTarget({ url: '/a\r\nb' }, '').url).toBe('/dashboard');
  });
  it('prefers the focused window', () => {
    const a = { id: 'a', focused: false, visibilityState: 'hidden' };
    const b = { id: 'b', focused: true, visibilityState: 'visible' };
    expect(Core.pickClient([a, b])).toBe(b);
    expect(Core.pickClient([])).toBeNull();
  });
});

describe('push-client-pure', () => {
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1';
  const base = { secureContext: true, hasServiceWorker: true, hasPushManager: true, hasNotification: true, standalone: false };
  it('iOS requires standalone install', () => {
    const platform = detectPlatform({ ua: IOS });
    expect(platform).toMatchObject({ os: 'ios', browser: 'safari', inApp: null });
    expect(assessPushSupport({ ...base, platform }).state).toBe('ios-needs-install');
    expect(assessPushSupport({ ...base, platform, standalone: true }).state).toBe('ready');
    expect(assessPushSupport({ ...base, platform, hasServiceWorker: false, hasPushManager: false }).state).toBe('ios-too-old');
  });
  it('detects iPadOS desktop UA, in-app browsers, Samsung and insecure contexts', () => {
    expect(detectPlatform({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 }).os).toBe('ios');
    const insta = detectPlatform({ ua: 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36 Instagram 300.0' });
    expect(assessPushSupport({ ...base, platform: insta }).state).toBe('in-app-browser');
    const samsung = detectPlatform({ ua: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36 Version/4.0' });
    expect(samsung).toMatchObject({ browser: 'samsung', inApp: null });
    expect(assessPushSupport({ ...base, platform: samsung, secureContext: false }).state).toBe('insecure');
    expect(assessPushSupport({ ...base, platform: samsung, hasPushManager: false }).state).toBe('unsupported');
  });
  it('recovery steps differ per platform', () => {
    expect(deniedRecoverySteps(detectPlatform({ ua: IOS })).join(' ')).toContain('تنظیمات آیفون');
    expect(deniedRecoverySteps(detectPlatform({ ua: 'Mozilla/5.0 Firefox/127.0 (X11; Linux x86_64)' })).join(' ')).toContain('Clear permission');
  });
  it('prompt backoff 3 -> 7 -> 14 -> 30 days', () => {
    const day = 86400_000;
    expect(promptDelayMs(1)).toBe(3 * day);
    expect(promptDelayMs(2)).toBe(7 * day);
    expect(promptDelayMs(9)).toBe(30 * day);
    const t = 1_000 * day;
    expect(shouldShowPrompt({ dismissedAt: null, dismissCount: 0 }, t)).toBe(true);
    expect(shouldShowPrompt({ dismissedAt: t - 2 * day, dismissCount: 1 }, t)).toBe(false);
    expect(shouldShowPrompt({ dismissedAt: t - 4 * day, dismissCount: 1 }, t)).toBe(true);
    expect(shouldShowPrompt({ dismissedAt: t - 4 * day, dismissCount: 2 }, t)).toBe(false);
  });
  it('vapid key comparison and base64url round trip', () => {
    const bytes = new Uint8Array([1, 2, 250, 251, 252]);
    const b64 = bytesToBase64Url(bytes);
    expect([...urlBase64ToUint8Array(b64)]).toEqual([...bytes]);
    expect(vapidKeyMatches(bytes, b64)).toBe(true);
    expect(vapidKeyMatches(bytes, bytesToBase64Url(new Uint8Array([9, 9])))).toBe(false);
    expect(vapidKeyMatches(null, b64)).toBe(true);
  });
  it('isSafeInternalPath rejects open redirects and control characters', async () => {
    const { isSafeInternalPath } = await import('../../../web-panel/src/lib/push-client-pure.js');
    for (const bad of ['//evil.com', '/\\evil', '/\t/x', '/a\nb', 'https://x.com', '', 5, null]) expect(isSafeInternalPath(bad)).toBe(false);
    expect(isSafeInternalPath('/tasks?open=1')).toBe(true);
  });
  it('parses reminder action deep links strictly', () => {
    expect(parseReminderAction('?reminder=123e4567-e89b-12d3-a456-426614174000&act=done')).toEqual({ id: '123e4567-e89b-12d3-a456-426614174000', act: 'done' });
    expect(parseReminderAction('?reminder=abc&act=done')).toBeNull();
    expect(parseReminderAction('?reminder=123e4567-e89b-12d3-a456-426614174000&act=delete')).toBeNull();
  });
});
