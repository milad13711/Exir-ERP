import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// منطق خالص سمت مرورگر (web-panel/src/lib/notification-logic.ts) — بدون وابستگی؛ با import پویا تا rootDir کامپایل بک‌اند نشکند.
type NotifLike = { id: string; type: string; title: string; body?: string | null; link?: string | null; readAt: string | null; createdAt: string; category?: string | null; important?: boolean | null };
const WEB = resolve(__dirname, '../../../web-panel/src/lib/notification-logic.ts');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const L: any = await import(pathToFileURL(WEB).href);
const { badgeLabel, categoryOf, detectArrivals, filterItems, groupByDay, isImportant, isSticky, limitStack, navBadgeFor, nextPollDelay, relativeTimeFa, safeHref, summarizeAttention, tabTitle, toastDecision } = L;

const NOW = new Date('2026-11-08T08:30:00Z'); // 12:00 تهران
const n = (o: Partial<NotifLike> = {}): NotifLike => ({ id: 'a', type: 'report.referred', title: 't', readAt: null, createdAt: new Date(NOW.getTime() - 60_000).toISOString(), ...o });

describe('badge and tab title', () => {
  it('badge: hidden at 0, Persian digits, 99+ cap', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(3)).toBe('۳');
    expect(badgeLabel(99)).toBe('۹۹');
    expect(badgeLabel(100)).toBe('۹۹+');
    expect(badgeLabel(NaN)).toBe('');
  });
  it('tab title prefix is replaced, not stacked, and removed at zero', () => {
    expect(tabTitle('داشبورد', 3)).toBe('(۳) داشبورد');
    expect(tabTitle('(۳) داشبورد', 5)).toBe('(۵) داشبورد');
    expect(tabTitle('(۹۹+) داشبورد', 0)).toBe('داشبورد');
  });
});

describe('importance and stickiness', () => {
  it('referrals/approvals/assigned tasks are important and sticky; chatter is not', () => {
    expect(categoryOf(n())).toBe('referrals');
    expect(isImportant(n())).toBe(true);
    expect(isSticky(n({ type: 'task.assigned' }))).toBe(true);
    expect(isImportant(n({ type: 'task.comment' }))).toBe(false);
    expect(isSticky(n({ type: 'billing.invoice_issued' }))).toBe(false);
    expect(isSticky(n({ type: 'messenger.mention' }))).toBe(true);
    expect(isImportant(n({ type: 'notification.reminder', important: false }))).toBe(false);
    expect(isImportant(n({ type: 'referral.assigned', category: 'approvals' }))).toBe(true);
    expect(isImportant(n({ type: 'referral.accepted', category: 'approvals' }))).toBe(false);
  });
  it('server flag wins', () => expect(isImportant(n({ type: 'x.y', important: true }))).toBe(true));
});

describe('toast decision (preferences, categories, quiet hours)', () => {
  it('shows by default and stays sticky for important', () => {
    expect(toastDecision(n(), null, NOW)).toEqual({ show: true, sticky: true, sound: true });
    expect(toastDecision(n({ type: 'billing.paid' }), null, NOW).sticky).toBe(false);
  });
  it('respects the global toggle, per-category inApp off, and sound pref', () => {
    expect(toastDecision(n(), { toastEnabled: false }, NOW).show).toBe(false);
    expect(toastDecision(n(), { categoryPrefs: { referrals: { inApp: false } } }, NOW).show).toBe(false);
    expect(toastDecision(n(), { soundEnabled: false }, NOW).sound).toBe(false);
  });
  it('suppressed in quiet hours except critical alarms', () => {
    const quiet = { quietHoursEnabled: true, quietStart: '11:00', quietEnd: '13:00' };
    expect(toastDecision(n(), quiet, NOW).show).toBe(false);
    expect(toastDecision(n({ type: 'reminder.alarm' }), quiet, NOW).show).toBe(true);
  });
});

describe('arrivals and stack', () => {
  const old = new Date(NOW.getTime() - 3600_000).toISOString();
  it('only unseen, unread, recent items; oldest first', () => {
    const items = [n({ id: '3' }), n({ id: '2', createdAt: new Date(NOW.getTime() - 120_000).toISOString() }), n({ id: 'old', createdAt: old }), n({ id: 'read', readAt: old }), n({ id: 'seen' })];
    expect(detectArrivals(items, new Set(['seen']), NOW).map((x: any) => x.id)).toEqual(['2', '3']);
  });
  it('stack max 3 drops non-sticky first, then oldest sticky', () => {
    const mk = (id: string, sticky: boolean) => ({ id, sticky, at: 0 });
    let r = limitStack([mk('a', true), mk('b', false), mk('c', true), mk('d', true)]);
    expect(r.visible.map((t: any) => t.id)).toEqual(['a', 'c', 'd']);
    expect(r.hidden).toBe(1);
    r = limitStack([mk('a', true), mk('b', true), mk('c', true), mk('d', true)]);
    expect(r.visible.map((t: any) => t.id)).toEqual(['b', 'c', 'd']);
    expect(limitStack([mk('a', false)]).hidden).toBe(0);
  });
});

describe('grouping, filters, time, links', () => {
  it('groups into today / earlier and skips empty groups', () => {
    const items = [n({ id: '1' }), n({ id: '2', createdAt: new Date(NOW.getTime() - 3 * 86400_000).toISOString() })];
    const g = groupByDay(items, NOW);
    expect(g.map((x: any) => x.key)).toEqual(['today', 'earlier']);
    expect(groupByDay([items[0]], NOW).map((x: any) => x.key)).toEqual(['today']);
    expect(groupByDay([], NOW)).toEqual([]);
  });
  it('filters unread / important', () => {
    const items = [n({ id: '1' }), n({ id: '2', readAt: NOW.toISOString() }), n({ id: '3', type: 'billing.paid' })];
    expect(filterItems(items, 'unread').map((x: any) => x.id)).toEqual(['1', '3']);
    expect(filterItems(items, 'important').map((x: any) => x.id)).toEqual(['1']);
    expect(filterItems(items, 'all')).toHaveLength(3);
  });
  it('relative time', () => {
    expect(relativeTimeFa(new Date(NOW.getTime() - 10_000).toISOString(), NOW)).toBe('همین الان');
    expect(relativeTimeFa(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('۵ دقیقه پیش');
    expect(relativeTimeFa(new Date(NOW.getTime() - 3 * 3600_000).toISOString(), NOW)).toBe('۳ ساعت پیش');
    expect(relativeTimeFa(new Date(NOW.getTime() - 3 * 86400_000).toISOString(), NOW)).toBeNull();
  });
  it('safeHref rejects external and protocol-relative links', () => {
    expect(safeHref('/reports?id=1')).toBe('/reports?id=1');
    for (const bad of ['https://evil.com', '//evil.com', '\\evil', null, undefined, '/a\nb']) expect(safeHref(bad as string)).toBe('/notifications');
  });
});

describe('poll backoff', () => {
  it('visible 8s, slows when idle, hidden 60s, backs off on failures with a cap', () => {
    expect(nextPollDelay({ visible: true, idleMs: 0, failures: 0 })).toBe(8000);
    expect(nextPollDelay({ visible: true, idleMs: 3 * 60_000, failures: 0 })).toBe(15000);
    expect(nextPollDelay({ visible: true, idleMs: 11 * 60_000, failures: 0 })).toBe(30000);
    expect(nextPollDelay({ visible: false, idleMs: 0, failures: 0 })).toBe(60000);
    expect(nextPollDelay({ visible: true, idleMs: 0, failures: 2 })).toBe(32000);
    expect(nextPollDelay({ visible: false, idleMs: 0, failures: 9 })).toBe(120000);
  });
});

describe('attention + menu badges', () => {
  it('summarizes by category, ignores read', () => {
    const items = [n({ id: '1' }), n({ id: '2' }), n({ id: '3', type: 'task.assigned' }), n({ id: '4', readAt: NOW.toISOString() })];
    const s = summarizeAttention(items);
    expect(s.map((g: any) => [g.category, g.count])).toEqual([['referrals', 2], ['tasks', 1]]);
  });
  it('menu badge only for single-segment hrefs', () => {
    const by = { '/tasks': 3, '/crm': 2 };
    expect(navBadgeFor('/tasks', by)).toBe(3);
    expect(navBadgeFor('/crm/funnel', by)).toBe(0);
    expect(navBadgeFor('/approvals', by)).toBe(0);
    expect(navBadgeFor('/tasks', null)).toBe(0);
  });
});
