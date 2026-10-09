import { describe, expect, it } from 'vitest';
import {
  applyResult,
  classifyDbLatency,
  classifyDisk,
  classifyErrorRate,
  classifyTls,
  classifyUrlStatus,
  emptyMonitorState,
  recordSent,
  resolveAlertPhone,
  sanitizeAlertText,
  shouldSend,
  type CheckState,
} from './monitoring-logic.js';

const T = (n: number) => new Date(Date.UTC(2026, 9, 9, 0, n)).toISOString();

describe('classifiers', () => {
  it('disk thresholds: warn <15, crit <8', () => {
    expect(classifyDisk(40)).toBe('ok');
    expect(classifyDisk(14.9)).toBe('warn');
    expect(classifyDisk(7.9)).toBe('crit');
    expect(classifyDisk(NaN)).toBe('unknown');
  });
  it('tls thresholds: warn <21 days, crit <7 days', () => {
    expect(classifyTls(60)).toBe('ok');
    expect(classifyTls(20)).toBe('warn');
    expect(classifyTls(6)).toBe('crit');
    expect(classifyTls(-1)).toBe('crit');
  });
  it('db latency', () => {
    expect(classifyDbLatency(20)).toBe('ok');
    expect(classifyDbLatency(700)).toBe('warn');
    expect(classifyDbLatency(2500)).toBe('crit');
  });
  it('url: 2xx/3xx ok, 4xx/5xx/null crit', () => {
    expect(classifyUrlStatus(200)).toBe('ok');
    expect(classifyUrlStatus(302)).toBe('ok');
    expect(classifyUrlStatus(502)).toBe('crit');
    expect(classifyUrlStatus(404)).toBe('crit');
    expect(classifyUrlStatus(null)).toBe('crit');
  });
  it('error rate: absolute thresholds and relative spike', () => {
    expect(classifyErrorRate(2, 20)).toBe('ok');
    expect(classifyErrorRate(30, 100)).toBe('warn');
    expect(classifyErrorRate(120, 200)).toBe('crit');
    // spike: 12 now vs ~0.03 baseline per window
    expect(classifyErrorRate(12, 16)).toBe('warn');
    // noisy-but-steady system: 12 now with a high baseline is not a spike
    expect(classifyErrorRate(12, 144 * 12 + 12)).toBe('ok');
  });
});

describe('applyResult state machine', () => {
  const crit = { level: 'crit' as const, detail: 'down' };
  const ok = { level: 'ok' as const, detail: 'up' };

  it('needs N consecutive failures before alerting (N=2)', () => {
    const a = applyResult(undefined, crit, T(0), 2);
    expect(a.notify).toBeNull();
    expect(a.next.consecutive).toBe(1);
    const b = applyResult(a.next, crit, T(5), 2);
    expect(b.notify).toEqual({ type: 'alert', level: 'crit' });
    expect(b.next.alertOpen).toBe(true);
  });

  it('a single blip that recovers never alerts and sends no recovery', () => {
    const a = applyResult(undefined, crit, T(0), 2);
    const b = applyResult(a.next, ok, T(5), 2);
    expect(b.notify).toBeNull();
    expect(b.next.consecutive).toBe(0);
  });

  it('does not re-alert while the same level persists', () => {
    let s: CheckState | undefined;
    const notifies: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      const r = applyResult(s, crit, T(i * 5), 2);
      s = r.next;
      if (r.notify) notifies.push(r.notify);
    }
    expect(notifies).toHaveLength(1);
  });

  it('sends exactly one recovery after an alert', () => {
    let s = applyResult(applyResult(undefined, crit, T(0), 2).next, crit, T(5), 2).next;
    const r1 = applyResult(s, ok, T(10), 2);
    expect(r1.notify).toEqual({ type: 'recovery' });
    const r2 = applyResult(r1.next, ok, T(15), 2);
    expect(r2.notify).toBeNull();
  });

  it('escalation warn -> crit alerts again', () => {
    const warn = { level: 'warn' as const, detail: 'w' };
    const a = applyResult(undefined, warn, T(0), 1);
    expect(a.notify).toEqual({ type: 'alert', level: 'warn' });
    const b = applyResult(a.next, crit, T(5), 1);
    expect(b.notify).toEqual({ type: 'alert', level: 'crit' });
    // crit -> warn (de-escalation) is silent
    const c = applyResult(b.next, warn, T(10), 1);
    expect(c.notify).toBeNull();
  });

  it('unknown never alerts and keeps the previous level', () => {
    const a = applyResult(undefined, { level: 'unknown', detail: 'n/a' }, T(0), 1);
    expect(a.notify).toBeNull();
    const down = applyResult(undefined, crit, T(1), 1).next;
    const b = applyResult(down, { level: 'unknown', detail: 'probe broke' }, T(2), 1);
    expect(b.next.level).toBe('crit');
    expect(b.notify).toBeNull();
  });
});

describe('dedupe + daily cap', () => {
  it('one send per kind per day, new day resets', () => {
    const s = emptyMonitorState();
    expect(shouldSend(s, '2026-10-09', 'disk:warn', 10).send).toBe(true);
    recordSent(s, '2026-10-09', 'disk:warn', true);
    expect(shouldSend(s, '2026-10-09', 'disk:warn', 10)).toEqual({ send: false, reason: 'dedupe' });
    expect(shouldSend(s, '2026-10-09', 'db:crit', 10).send).toBe(true);
    expect(shouldSend(s, '2026-10-10', 'disk:warn', 10).send).toBe(true);
  });
  it('daily SMS cap blocks varying kinds (anti-spam / anti-pumping)', () => {
    const s = emptyMonitorState();
    for (let i = 0; i < 3; i++) recordSent(s, '2026-10-09', `k${i}`, true);
    expect(shouldSend(s, '2026-10-09', 'k99', 3)).toEqual({ send: false, reason: 'cap' });
    expect(shouldSend(s, '2026-10-10', 'k99', 3).send).toBe(true);
  });
  it('prunes entries older than 3 days', () => {
    const s = emptyMonitorState();
    recordSent(s, '2026-10-01', 'old', true);
    recordSent(s, '2026-10-09', 'new', true);
    expect(Object.keys(s.alertsSent)).toEqual(['2026-10-09:new']);
  });
});

describe('helpers', () => {
  it('phone fallback order MONITOR -> BACKUP -> ON_PREM_OWNER', () => {
    expect(resolveAlertPhone({ MONITOR_ALERT_PHONE: '1', BACKUP_ALERT_PHONE: '2', ON_PREM_OWNER_PHONE: '3' } as any)).toBe('1');
    expect(resolveAlertPhone({ BACKUP_ALERT_PHONE: '2', ON_PREM_OWNER_PHONE: '3' } as any)).toBe('2');
    expect(resolveAlertPhone({ ON_PREM_OWNER_PHONE: '3' } as any)).toBe('3');
    expect(resolveAlertPhone({} as any)).toBeNull();
  });
  it('sanitizeAlertText strips control chars and truncates', () => {
    expect(sanitizeAlertText('a\nb\u0000c')).toBe('a b c');
    expect(sanitizeAlertText('x'.repeat(500))).toHaveLength(300);
  });
});
