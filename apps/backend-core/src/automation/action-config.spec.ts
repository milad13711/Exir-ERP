import { describe, expect, it } from 'vitest';
import { resolveFixedOrFieldTarget } from './action-config.js';

describe('resolveFixedOrFieldTarget', () => {
  it('returns the fixed value in FIXED mode', () => {
    expect(resolveFixedOrFieldTarget('FIXED', 'user-1', undefined, {})).toBe('user-1');
  });

  it('returns null in FIXED mode with no fixed value set', () => {
    expect(resolveFixedOrFieldTarget('FIXED', undefined, undefined, {})).toBeNull();
  });

  it('reads the named payload field in FIELD mode', () => {
    expect(resolveFixedOrFieldTarget('FIELD', undefined, 'assigneeId', { assigneeId: 'user-2' })).toBe('user-2');
  });

  it('returns null in FIELD mode when the payload value is missing', () => {
    expect(resolveFixedOrFieldTarget('FIELD', undefined, 'assigneeId', {})).toBeNull();
  });

  it('returns null in FIELD mode when the payload value is null', () => {
    expect(resolveFixedOrFieldTarget('FIELD', undefined, 'assigneeId', { assigneeId: null })).toBeNull();
  });

  it('stringifies a numeric payload value', () => {
    expect(resolveFixedOrFieldTarget('FIELD', undefined, 'orderNo', { orderNo: 42 })).toBe('42');
  });
});
