import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { normalizeChecklistAttachmentTitle } from './checklist-attachment.util.js';
import { buildDailyReportBody } from './checklist-day.util.js';

describe('normalizeChecklistAttachmentTitle — نام اجباری فایل', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeChecklistAttachmentTitle('  رسید   بانک  ')).toBe('رسید بانک');
  });
  it('rejects empty, whitespace-only and 1-char names', () => {
    for (const bad of ['', '   ', 'a', undefined, 12]) {
      expect(() => normalizeChecklistAttachmentTitle(bad)).toThrow(BadRequestException);
    }
  });
  it('rejects bare file names such as IMG_2031.jpg', () => {
    expect(() => normalizeChecklistAttachmentTitle('IMG_2031.jpg')).toThrow(/نام گویا/);
  });
  it('rejects a name already used on the same item (case-insensitive)', () => {
    expect(() => normalizeChecklistAttachmentTitle('Invoice A', ['invoice a'])).toThrow(/همین نام/);
    expect(normalizeChecklistAttachmentTitle('Invoice B', ['invoice a'])).toBe('Invoice B');
  });
  it('rejects names over 120 chars', () => {
    expect(() => normalizeChecklistAttachmentTitle('x'.repeat(121))).toThrow(BadRequestException);
  });
});

describe('buildDailyReportBody — file list', () => {
  it('lists attached file names with their item, and omits the block when there are none', () => {
    const items = [{ title: 'ارسال نامه', description: null, done: true }];
    const withFiles = buildDailyReportBody('علی', '۱۴۰۵/۰۷/۱۵', items, [{ title: 'رسید پست', itemTitle: 'ارسال نامه' }]);
    expect(withFiles).toContain('فایل‌های پیوست (1):');
    expect(withFiles).toContain('- رسید پست (مربوط به: ارسال نامه)');
    expect(buildDailyReportBody('علی', 'x', items)).not.toContain('فایل‌های پیوست');
  });
});
