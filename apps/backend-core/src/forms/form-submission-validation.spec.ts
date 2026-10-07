import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { LIMITS, maskIp, normalizePhone, validateSubmission, type ValidatableField } from './form-submission-validation.js';

const fields: ValidatableField[] = [
  { id: 'f-name', type: 'SHORT_TEXT', label: 'نام', required: true, options: [] },
  { id: 'f-note', type: 'LONG_TEXT', label: 'توضیحات', required: false, options: [] },
  { id: 'f-mail', type: 'EMAIL', label: 'ایمیل', required: false, options: [] },
  { id: 'f-num', type: 'NUMBER', label: 'تعداد', required: false, options: [] },
  { id: 'f-pick', type: 'SINGLE_CHOICE', label: 'نوع', required: false, options: ['الف', 'ب'] },
  { id: 'f-multi', type: 'MULTI_CHOICE', label: 'علاقه', required: false, options: ['x', 'y', 'z'] },
  { id: 'f-rate', type: 'RATING', label: 'امتیاز', required: false, options: [] },
];
const form = { collectPhone: true, requirePhone: false, fields };

describe('validateSubmission', () => {
  it('accepts the legacy array shape, the map shape and flat HTML-form keys identically', () => {
    const a = validateSubmission(form, { answers: [{ fieldId: 'f-name', valueText: 'علی' }, { fieldId: 'f-multi', valueOptions: ['x', 'y'] }] });
    const b = validateSubmission(form, { answers: { 'f-name': 'علی', 'f-multi': ['x', 'y'] } });
    const c = validateSubmission(form, { 'f-name': 'علی', 'f-multi': ['x', 'y'] });
    expect(a.answers).toEqual(b.answers);
    expect(b.answers).toEqual(c.answers);
    expect(a.answers).toContainEqual({ fieldId: 'f-multi', valueText: null, valueOptions: ['x', 'y'] });
  });

  it('enforces required fields with a Persian message naming the field', () => {
    expect(() => validateSubmission(form, { answers: {} })).toThrow(/«نام»/);
  });

  it('requires a phone when the form demands it and normalizes Persian digits', () => {
    expect(() => validateSubmission({ ...form, requirePhone: true }, { answers: { 'f-name': 'a' } })).toThrow(BadRequestException);
    const ok = validateSubmission(form, { phone: '۰۹۱۲۱۲۳۴۵۶۷', answers: { 'f-name': 'a' } });
    expect(ok.respondentPhone).toBe('09121234567');
    expect(() => validateSubmission(form, { phone: 'abc', answers: { 'f-name': 'a' } })).toThrow(/موبایل/);
  });

  it('rejects options that are not in the schema (single and multi)', () => {
    expect(() => validateSubmission(form, { answers: { 'f-name': 'a', 'f-pick': 'ج' } })).toThrow(BadRequestException);
    expect(() => validateSubmission(form, { answers: { 'f-name': 'a', 'f-multi': ['x', 'nope'] } })).toThrow(BadRequestException);
  });

  it('validates type shapes: email, number, rating', () => {
    expect(() => validateSubmission(form, { answers: { 'f-name': 'a', 'f-mail': 'not-an-email' } })).toThrow(/ایمیل/);
    expect(() => validateSubmission(form, { answers: { 'f-name': 'a', 'f-num': '12abc' } })).toThrow(/عدد/);
    expect(() => validateSubmission(form, { answers: { 'f-name': 'a', 'f-rate': '9' } })).toThrow(/۱ تا ۵/);
    const ok = validateSubmission(form, { answers: { 'f-name': 'a', 'f-num': '۱۲۳', 'f-rate': 4 } });
    expect(ok.answers.find((x) => x.fieldId === 'f-num')?.valueText).toBe('123');
    expect(ok.answers.find((x) => x.fieldId === 'f-rate')?.valueText).toBe('4');
  });

  it('enforces max lengths', () => {
    expect(() => validateSubmission(form, { answers: { 'f-name': 'x'.repeat(LIMITS.shortText + 1) } })).toThrow(/طولانی/);
    expect(() => validateSubmission(form, { answers: { 'f-name': 'a', 'f-note': 'x'.repeat(LIMITS.longText + 1) } })).toThrow(/طولانی/);
  });

  it('ignores unknown field ids and strips control characters', () => {
    const r = validateSubmission(form, { answers: { 'f-name': 'a\u0000b', ghost: 'zzz' } });
    expect(r.answers).toEqual([{ fieldId: 'f-name', valueText: 'ab', valueOptions: [] }]);
  });

  it('flags the honeypot and reads source/utm safely (non-http urls dropped)', () => {
    const r = validateSubmission(form, {
      answers: { 'f-name': 'a' },
      _hp: 'bot',
      source: { url: 'javascript:alert(1)', referrer: 'https://x.test/', utm: { utm_source: 'insta', evil: 'x' } },
    });
    expect(r.honeypotTripped).toBe(true);
    expect(r.source.url).toBeNull();
    expect(r.source.referrer).toBe('https://x.test/');
    expect(r.source.utm).toEqual({ utm_source: 'insta' });
  });

  it('rejects a non-object body', () => {
    expect(() => validateSubmission(form, 'x')).toThrow(BadRequestException);
    expect(() => validateSubmission(form, null)).toThrow(BadRequestException);
  });
});

describe('helpers', () => {
  it('maskIp drops the last octet / ipv6 tail', () => {
    expect(maskIp('185.10.20.30')).toBe('185.10.20.x');
    expect(maskIp('::ffff:1.2.3.4')).toBe('1.2.3.x');
    expect(maskIp('2001:db8:1:2::1')).toBe('2001:db8:1:****');
    expect(maskIp(undefined)).toBeNull();
  });
  it('normalizePhone', () => {
    expect(normalizePhone('+98 912 123 4567')).toBe('+989121234567');
    expect(normalizePhone('12')).toBeNull();
  });
});
