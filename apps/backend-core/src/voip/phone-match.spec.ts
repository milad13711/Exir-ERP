import { describe, expect, it } from 'vitest';
import { normalizePhone, phonesMatch } from './phone-match.js';

describe('normalizePhone', () => {
  it('strips a +98 / 0098 country prefix', () => {
    expect(normalizePhone('+989121234567')).toBe('9121234567');
    expect(normalizePhone('00989121234567')).toBe('9121234567');
  });

  it('strips a leading domestic 0', () => {
    expect(normalizePhone('09121234567')).toBe('9121234567');
  });

  it('leaves a bare number without any prefix untouched', () => {
    expect(normalizePhone('9121234567')).toBe('9121234567');
  });

  it('drops non-digit characters (spaces, dashes, parens)', () => {
    expect(normalizePhone('0912 123-4567')).toBe('9121234567');
  });
});

describe('phonesMatch', () => {
  it('matches the same number in different formats', () => {
    expect(phonesMatch('09121234567', '+989121234567')).toBe(true);
    expect(phonesMatch('09121234567', '00989121234567')).toBe(true);
  });

  it('does not match two different numbers', () => {
    expect(phonesMatch('09121234567', '09129999999')).toBe(false);
  });

  it('does not match two empty strings', () => {
    expect(phonesMatch('', '')).toBe(false);
  });
});
