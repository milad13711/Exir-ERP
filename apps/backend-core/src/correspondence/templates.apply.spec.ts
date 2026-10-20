import { describe, expect, it } from 'vitest';
import { applyTemplate, TEMPLATE_PLACEHOLDERS, unknownPlaceholders } from './templates.apply.js';
import { DEFAULT_TEMPLATES } from './templates.defaults.js';
import { sanitizeLetterHtml } from './pdf/sanitize-letter-html.js';

describe('applyTemplate', () => {
  it('جایگزینی ساده با فاصله‌های اختیاری', () => {
    const r = applyTemplate({ subject: 'به {{ recipientName }}', bodyHtml: '<p>{{recipientName}} - {{date}}</p>' }, { recipientName: 'علی', date: '۱۴۰۵/۰۱/۰۱' });
    expect(r.subject).toBe('به علی');
    expect(r.bodyHtml).toBe('<p>علی - ۱۴۰۵/۰۱/۰۱</p>');
  });
  it('مقدار درج‌شده در بدنه HTML-escape می‌شود', () => {
    const r = applyTemplate({ subject: '', bodyHtml: '<p>{{recipientName}}</p>' }, { recipientName: '<img src=x onerror=alert(1)>"\'&' });
    expect(r.bodyHtml).toBe('<p>&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;</p>');
    expect(sanitizeLetterHtml(r.bodyHtml)).not.toMatch(/<img/);
  });
  it('موضوع متن ساده است (دوبار escape نمی‌شود)', () => {
    expect(applyTemplate({ subject: '{{subject}}', bodyHtml: '' }, { subject: 'الف & ب' }).subject).toBe('الف & ب');
  });
  it('جانشین ناشناخته و مقدار نداده‌شده دست‌نخورده می‌مانند؛ null → خالی', () => {
    const r = applyTemplate({ subject: '', bodyHtml: '{{evil}} {{number}} {{senderName}}' }, { senderName: null });
    expect(r.bodyHtml).toBe('{{evil}} {{number}} ');
  });
  it('تک‌گذر: مقدار حاوی جانشین دوباره جایگزین نمی‌شود', () => {
    const r = applyTemplate({ subject: '', bodyHtml: '{{recipientName}}' }, { recipientName: '{{senderName}}', senderName: 'X' });
    expect(r.bodyHtml).toBe('{{senderName}}');
  });
  it('جانشین prototype/constructor نادیده', () => {
    const r = applyTemplate({ subject: '', bodyHtml: '{{constructor}} {{__proto__}}' }, {});
    expect(r.bodyHtml).toBe('{{constructor}} {{__proto__}}');
  });
});

describe('unknownPlaceholders / قالب‌های پیش‌فرض', () => {
  it('شناسایی ناشناخته‌ها', () => {
    expect(unknownPlaceholders('{{date}} {{foo}} {{ bar }}')).toEqual(['foo', 'bar']);
  });
  it('همه‌ی قالب‌های پیش‌فرض فقط جانشین مجاز دارند و پس از پاک‌ساز تغییر نمی‌کنند', () => {
    expect(DEFAULT_TEMPLATES.length).toBeGreaterThanOrEqual(7);
    for (const t of DEFAULT_TEMPLATES) {
      expect(unknownPlaceholders(t.bodyHtml + t.subject), t.name).toEqual([]);
      expect(sanitizeLetterHtml(t.bodyHtml), t.name).toBe(t.bodyHtml);
    }
    expect(TEMPLATE_PLACEHOLDERS).toContain('orgName');
  });
});
