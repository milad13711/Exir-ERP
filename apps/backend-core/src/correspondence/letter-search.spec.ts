import { describe, expect, it } from 'vitest';
import { buildRegisterCsv, csvCell, type RegisterRow } from './letter-register-csv.js';
import { buildLetterFilterWhere, clampPageSize } from './letter-search.js';
import { tehranDayEnd, tehranDayStart } from './tehran-date.js';
import { classifyReferral, classifyResponseDue } from './reminder-select.js';
import { canModifyAttachments } from './correspondence-attachment-access.js';

const flat = (w: unknown) => JSON.stringify(w);

describe('buildLetterFilterWhere', () => {
  it('empty filters still hide archived by default', () => {
    expect(buildLetterFilterWhere({}, 'u')).toEqual({ AND: [{ archivedAt: null }] });
    expect(buildLetterFilterWhere({ archived: 'all' }, 'u')).toEqual({});
    expect(flat(buildLetterFilterWhere({ archived: 'only' }, 'u'))).toContain('"archivedAt":{"not":null}');
  });
  it('number searches both the secretariat number and the external number', () => {
    const s = flat(buildLetterFilterWhere({ number: ' 123 ', archived: 'all' }, null));
    expect(s).toContain('"letterNumber":{"contains":"123"');
    expect(s).toContain('"externalNumber":{"contains":"123"');
  });
  it('free text covers subject, plain-text body, numbers, parties, recipients — never raw html', () => {
    const s = flat(buildLetterFilterWhere({ q: 'قرارداد', archived: 'all' }, null));
    for (const f of ['subject', 'bodyText', 'letterNumber', 'externalNumber', 'senderName', 'senderOrgName', 'recipientsText']) expect(s).toContain(`"${f}"`);
    expect(s).not.toContain('bodyHtml');
  });
  it('whitelists enums and ignores junk', () => {
    const s = flat(buildLetterFilterWhere({ type: 'HACK', priority: 'X', confidentiality: 'Y', status: ['DRAFT', 'NOPE'], archived: 'all' }, null));
    expect(s).not.toContain('HACK');
    expect(s).toContain('"status":{"in":["DRAFT"]}');
    expect(buildLetterFilterWhere({ type: 'INCOMING', archived: 'all' }, null)).toEqual({ AND: [{ type: 'INCOMING' }] });
  });
  it('Jalali-derived ISO dates become Tehran day bounds (end exclusive)', () => {
    const w = buildLetterFilterWhere({ dateFrom: '2026-10-20', dateTo: '2026-10-20', archived: 'all' }, null) as { AND: { letterDate: { gte: Date; lt: Date } }[] };
    expect(w.AND[0].letterDate.gte.toISOString()).toBe('2026-10-19T20:30:00.000Z');
    expect(w.AND[0].letterDate.lt.toISOString()).toBe('2026-10-20T20:30:00.000Z');
    expect(tehranDayStart('bad')).toBeNull();
    expect(tehranDayEnd(undefined)).toBeNull();
  });
  it('dateField is whitelisted', () => {
    expect(flat(buildLetterFilterWhere({ dateFrom: '2026-10-20', dateField: 'externalDate', archived: 'all' }, null))).toContain('"externalDate"');
    expect(flat(buildLetterFilterWhere({ dateFrom: '2026-10-20', dateField: 'passwordHash' as never, archived: 'all' }, null))).toContain('"letterDate"');
  });
  it('mine needs a user id; awaitingReply and responseOverdue add status constraints', () => {
    expect(buildLetterFilterWhere({ mine: true, archived: 'all' }, null)).toEqual({});
    expect(flat(buildLetterFilterWhere({ mine: true, archived: 'all' }, 'u9'))).toContain('"userId":"u9"');
    const a = flat(buildLetterFilterWhere({ awaitingReply: true, archived: 'all' }, null));
    expect(a).toContain('"type":"INCOMING"');
    expect(a).toContain('"answeredAt":null');
    expect(flat(buildLetterFilterWhere({ responseOverdue: true, archived: 'all' }, null, new Date('2026-01-01T00:00:00Z')))).toContain('"responseDueAt":{"lt"');
  });
  it('page size is clamped', () => {
    expect(clampPageSize(undefined)).toBe(30);
    expect(clampPageSize(0.4)).toBe(30);
    expect(clampPageSize(5000)).toBe(100);
    expect(clampPageSize(-3)).toBe(1);
  });
});

describe('register CSV', () => {
  const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
    type: 'INCOMING', status: 'REGISTERED', letterNumber: 'وارده/1405/00001', externalNumber: 'A-77', externalDate: new Date('2026-10-01T00:00:00Z'),
    letterDate: new Date('2026-10-01T00:00:00Z'), registeredAt: new Date('2026-10-02T06:00:00Z'), subject: 'درخواست', senderName: 'علی', senderOrgName: 'شرکت X',
    recipientsText: '', categoryName: 'مالی', priority: 'URGENT', confidentiality: 'NORMAL', responseDueAt: null, createdByName: 'ثبت‌کننده', voidReason: null, pageCount: 3, ...over,
  });
  it('neutralises spreadsheet formulas', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rx']) expect(csvCell(evil).replace(/^"/, '')[0]).toBe("'");
    expect(csvCell('normal')).toBe('normal');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('line1 line2');
    expect(csvCell(null)).toBe('');
  });
  it('has a BOM, both numbers and applies formula safety to every cell', () => {
    const csv = buildRegisterCsv([row({ subject: '=cmd|calc', senderName: '@x', senderOrgName: null })]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('وارده/1405/00001');
    expect(csv).toContain('A-77');
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain("'@x");
    expect(csv).toContain('فوری');
  });
  it('lists voided letters with the reason (burned numbers stay visible)', () => {
    const csv = buildRegisterCsv([row({ status: 'VOID', voidReason: 'اشتباه' })]);
    expect(csv).toContain('باطل‌شده');
    expect(csv).toContain('اشتباه');
  });
});

describe('reminder selection', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  const ref = (over = {}) => ({ status: 'PENDING', kind: 'ACTION', dueAt: new Date('2026-10-20T20:00:00Z'), dueNotifiedAt: null, overdueNotifiedAt: null, ...over });
  it('due soon (≤24h) once', () => {
    expect(classifyReferral(ref(), now)).toBe('DUE_SOON');
    expect(classifyReferral(ref({ dueNotifiedAt: now }), now)).toBeNull();
    expect(classifyReferral(ref({ dueAt: new Date('2026-10-25T00:00:00Z') }), now)).toBeNull();
  });
  it('overdue once; closed/info/no-due never', () => {
    const late = ref({ dueAt: new Date('2026-10-19T00:00:00Z') });
    expect(classifyReferral(late, now)).toBe('OVERDUE');
    expect(classifyReferral({ ...late, overdueNotifiedAt: now }, now)).toBeNull();
    expect(classifyReferral({ ...late, status: 'DONE' }, now)).toBeNull();
    expect(classifyReferral({ ...late, kind: 'INFO' }, now)).toBeNull();
    expect(classifyReferral({ ...late, dueAt: null }, now)).toBeNull();
  });
  it('response due for open incoming letters, once per kind', () => {
    const l = { type: 'INCOMING', status: 'IN_PROGRESS', responseDueAt: new Date('2026-10-21T00:00:00Z'), archivedAt: null, sentReminders: [] as string[] };
    expect(classifyResponseDue(l, now)).toBe('RESPONSE_DUE');
    expect(classifyResponseDue({ ...l, sentReminders: ['RESPONSE_DUE'] }, now)).toBeNull();
    const late = { ...l, responseDueAt: new Date('2026-10-01T00:00:00Z') };
    expect(classifyResponseDue(late, now)).toBe('RESPONSE_OVERDUE');
    expect(classifyResponseDue({ ...late, sentReminders: ['RESPONSE_DUE', 'RESPONSE_OVERDUE'] }, now)).toBeNull();
    expect(classifyResponseDue({ ...late, status: 'ANSWERED' }, now)).toBeNull();
    expect(classifyResponseDue({ ...late, archivedAt: now }, now)).toBeNull();
    expect(classifyResponseDue({ ...late, type: 'OUTGOING' }, now)).toBeNull();
  });
});

describe('canModifyAttachments', () => {
  it('drafts are free; signed letters take nothing but receipts; void/archived are frozen', () => {
    expect(canModifyAttachments('OUTGOING', 'DRAFT', false, 'delete')).toBe(true);
    expect(canModifyAttachments('OUTGOING', 'ISSUED', false, 'write')).toBe(false);
    expect(canModifyAttachments('OUTGOING', 'ISSUED', false, 'write', 'LetterReceipt')).toBe(true);
    expect(canModifyAttachments('OUTGOING', 'ISSUED', false, 'delete', 'LetterReceipt')).toBe(false);
    expect(canModifyAttachments('OUTGOING', 'PENDING_SIGNATURE', false, 'write')).toBe(false);
    expect(canModifyAttachments('OUTGOING', 'VOID', false, 'write')).toBe(false);
    expect(canModifyAttachments('INCOMING', 'REGISTERED', false, 'write')).toBe(true);
    expect(canModifyAttachments('INCOMING', 'REGISTERED', true, 'write')).toBe(false);
    expect(canModifyAttachments('INCOMING', 'REGISTERED', false, 'delete', 'LetterScan')).toBe(false);
    expect(canModifyAttachments('INCOMING', 'REGISTERED', false, 'write', 'LetterScan')).toBe(true);
  });
});
