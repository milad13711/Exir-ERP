import { describe, expect, it } from 'vitest';
import { decideCompletion } from './completion-flow.js';

describe('decideCompletion', () => {
  it('finalizes directly from IN_PROGRESS when quality-control is not installed', () => {
    expect(decideCompletion('IN_PROGRESS', false, false)).toEqual({ action: 'FINALIZE' });
  });

  it('finalizes directly from IN_PROGRESS when a PASS sample already exists', () => {
    expect(decideCompletion('IN_PROGRESS', true, true)).toEqual({ action: 'FINALIZE' });
  });

  it('moves IN_PROGRESS to AWAIT_QC when quality-control is installed and no PASS sample yet', () => {
    expect(decideCompletion('IN_PROGRESS', true, false)).toEqual({ action: 'AWAIT_QC' });
  });

  it('finalizes from QC_PENDING once a PASS sample exists', () => {
    expect(decideCompletion('QC_PENDING', true, true)).toEqual({ action: 'FINALIZE' });
  });

  it('stays STILL_AWAITING_QC from QC_PENDING with no PASS sample yet', () => {
    expect(decideCompletion('QC_PENDING', true, false)).toEqual({ action: 'STILL_AWAITING_QC' });
  });

  it('rejects any other status as invalid', () => {
    expect(decideCompletion('DRAFT', false, false)).toEqual({ action: 'INVALID_STATUS' });
    expect(decideCompletion('COMPLETED', false, false)).toEqual({ action: 'INVALID_STATUS' });
    expect(decideCompletion('RAW_MATERIAL_APPROVED', false, false)).toEqual({ action: 'INVALID_STATUS' });
  });
});
