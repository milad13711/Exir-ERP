import { describe, expect, it } from 'vitest';
import { renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('replaces every {key} with its payload value', () => {
    expect(renderTemplate('سفارش {orderNo} برای {productName}', { orderNo: 12, productName: 'کنسانتره' })).toBe(
      'سفارش 12 برای کنسانتره',
    );
  });

  it('leaves an unknown placeholder untouched', () => {
    expect(renderTemplate('مبلغ: {amount}', {})).toBe('مبلغ: {amount}');
  });

  it('leaves a placeholder untouched when its payload value is null', () => {
    expect(renderTemplate('کد: {code}', { code: null })).toBe('کد: {code}');
  });

  it('handles a template with no placeholders', () => {
    expect(renderTemplate('پیام ثابت', { x: 1 })).toBe('پیام ثابت');
  });
});
