import { describe, expect, it } from 'vitest';
import { normalizeTicketAlertSettings, sanitizeUserText, smsAllowed, ticketAlertText, withinCooldown, TICKET_ALERT_DEFAULTS } from './support-alerts.logic.js';

describe('ticket alert settings', () => {
  it('defaults to owner+admin with push and sms on', () => {
    expect(normalizeTicketAlertSettings(undefined)).toEqual(TICKET_ALERT_DEFAULTS);
    expect(TICKET_ALERT_DEFAULTS.roles).toEqual(['OWNER', 'ADMIN']);
  });
  it('sanitizes junk input and clamps numbers', () => {
    const s = normalizeTicketAlertSettings({ roles: ['OWNER', 'HACKER', 'OWNER'], extraUserIds: ['a', '', 5, 'a'], smsDailyCap: 9999, replyCooldownSec: -4, push: 'yes' });
    expect(s.roles).toEqual(['OWNER']);
    expect(s.extraUserIds).toEqual(['a']);
    expect(s.smsDailyCap).toBe(200);
    expect(s.replyCooldownSec).toBe(0);
    expect(s.push).toBe(true);
  });
  it('honours explicit off switches', () => {
    expect(normalizeTicketAlertSettings({ enabled: false, sms: false }).enabled).toBe(false);
    expect(smsAllowed({ sms: false, smsDailyCap: 5 }, 0)).toBe(false);
  });
});

describe('rate limiting', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  it('cooldown only applies inside the window', () => {
    expect(withinCooldown(new Date('2026-10-19T09:59:00Z'), now, 120)).toBe(true);
    expect(withinCooldown(new Date('2026-10-19T09:50:00Z'), now, 120)).toBe(false);
    expect(withinCooldown(null, now, 120)).toBe(false);
    expect(withinCooldown(new Date('2026-10-19T09:59:59Z'), now, 0)).toBe(false);
  });
  it('sms cap is per day count', () => {
    expect(smsAllowed({ sms: true, smsDailyCap: 3 }, 2)).toBe(true);
    expect(smsAllowed({ sms: true, smsDailyCap: 3 }, 3)).toBe(false);
  });
});

describe('alert text', () => {
  it('differs for new vs reply and stays short for sms', () => {
    const n = ticketAlertText('new', { tenantName: 'شرکت الف', subject: 'مشکل', preview: 'سلام '.repeat(100), ticketId: 'abc12345-x' });
    const r = ticketAlertText('reply', { tenantName: 'شرکت الف', subject: 'مشکل', preview: 'x', ticketId: 'abc12345-x' });
    expect(n.title).toContain('جدید');
    expect(r.title).toContain('پیام جدید');
    expect(n.body.length).toBeLessThan(260);
    expect(n.sms.length).toBeLessThan(140);
  });
});

describe('sanitizeUserText', () => {
  it('removes urls and bidi/control characters', () => {
    expect(sanitizeUserText('a http://x.ir/p b\u202e c\u0007')).not.toMatch(/x\.ir|\u202e|\u0007/);
  });
});
