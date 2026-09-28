import { describe, expect, it } from 'vitest';
import { bodyTextToHtml, distributeItemsIntoColumns, maxItemsFor, substituteBodyText, toAsciiDigits } from './certificate-text.util.js';
import { buildBodyText, buildItemsHtml, type CertificateForRender } from './certificate-render.service.js';
import { defaultTemplateSettings } from './certificate-template-settings.service.js';

const cert: CertificateForRender = {
  code: 'AB12CD34EF',
  recipientNameFa: 'علی رضایی',
  recipientNameEn: 'Ali Rezaei',
  nationalId: '0012345678',
  titleFa: 'مدیریت فروش',
  titleEn: 'Sales <Management>',
  durationHours: 40,
  startDate: new Date('2026-03-21T12:00:00Z'),
  endDate: new Date('2026-04-21T12:00:00Z'),
  score: 95,
  issuedByName: null,
  createdAt: new Date('2026-09-28T12:00:00Z'),
  items: Array.from({ length: 6 }, (_, i) => ({ titleFa: `آیتم ${i + 1}`, titleEn: `Item ${i + 1}` })),
};

describe('substituteBodyText', () => {
  it('replaces known placeholders, keeps unknown, empties missing', () => {
    expect(substituteBodyText('{title} {foo} {score}', { title: 'X' })).toBe('X {foo}');
  });
  it('collapses doubled spaces and space before comma', () => {
    expect(substituteBodyText('Ali, ID {nationalId} , done', {})).toBe('Ali, ID, done');
  });
});

describe('distributeItemsIntoColumns', () => {
  const list = Array.from({ length: 12 }, (_, i) => i + 1);
  it('fills column by column with max 4 rows', () => {
    expect(distributeItemsIntoColumns(list.slice(0, 6), 2)).toEqual([[1, 2, 3, 4], [5, 6]]);
  });
  it('caps at columns x 4', () => {
    expect(distributeItemsIntoColumns(list, 2).flat()).toHaveLength(8);
    expect(distributeItemsIntoColumns(list, 3).flat()).toHaveLength(12);
    expect(maxItemsFor(3)).toBe(12);
  });
});

describe('render helpers', () => {
  it('fa body uses Persian digits everywhere', () => {
    const text = buildBodyText(cert, 'fa', defaultTemplateSettings(), 'شرکت ۱۲۳ Test');
    expect(text).not.toMatch(/[0-9]/);
    expect(text).toContain('۰۰۱۲۳۴۵۶۷۸');
  });
  it('en body uses plain digits and English name, empty company by default', () => {
    const text = buildBodyText(cert, 'en', defaultTemplateSettings(), 'شرکت');
    expect(text).toContain('Ali Rezaei');
    expect(text).toContain('40 hours');
    expect(text).not.toMatch(/[۰-۹]/);
  });
  it('html-escapes substituted values', () => {
    expect(bodyTextToHtml(buildBodyText(cert, 'en', defaultTemplateSettings(), ''))).toContain('Sales &lt;Management&gt;');
  });
  it('items are bullets in 2 columns', () => {
    const html = buildItemsHtml(cert, 'en', 2);
    expect(html.match(/• /g)).toHaveLength(6);
    expect(html.match(/flex:1 1 0/g)).toHaveLength(2);
  });
  it('toAsciiDigits', () => {
    expect(toAsciiDigits('۰۱۲٣')).toBe('0123');
  });
});
