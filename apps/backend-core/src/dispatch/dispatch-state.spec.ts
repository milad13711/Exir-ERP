import { describe, expect, it } from 'vitest';
import {
  DispatchRuleError,
  assertDocsGate,
  assertFourEyes,
  assertStepAllowed,
  autoStatusAfter,
  statusForDocs,
  validateManualChange,
  type ProgressFacts,
} from './dispatch-state.js';

const base: ProgressFacts = {
  status: 'ACCEPTED',
  hasDriver: true,
  arrived: false,
  cleanlinessResult: null,
  tareKg: null,
  loaded: false,
  grossKg: null,
  netKg: null,
  loaderUserId: null,
  finalCheckResult: null,
  docsRequired: false,
  docsComplete: false,
  docsOverridden: false,
  readyGranted: false,
  departed: false,
  receiptDone: false,
  receiptRequiredBeforeDeparture: true,
  receiptOverridden: false,
  needsWeighing: false,
  weightConfirmed: false,
};

describe('autoStatusAfter', () => {
  it('advances along the checklist', () => {
    expect(autoStatusAfter('ACCEPTED', 'ARRIVAL')).toBe('VEHICLE_ARRIVED');
    expect(autoStatusAfter('VEHICLE_ARRIVED', 'CLEANLINESS')).toBe('CLEANLINESS_APPROVED');
    expect(autoStatusAfter('CLEANLINESS_APPROVED', 'TARE')).toBe('TARE_RECORDED');
    expect(autoStatusAfter('TARE_RECORDED', 'LOADING')).toBe('LOADED');
    expect(autoStatusAfter('LOADED', 'GROSS')).toBe('WEIGHED');
    expect(autoStatusAfter('FINAL_CHECK', 'READY')).toBe('READY_TO_DEPART');
    expect(autoStatusAfter('READY_TO_DEPART', 'DEPART')).toBe('IN_TRANSIT');
    expect(autoStatusAfter('IN_TRANSIT', 'DELIVER')).toBe('DELIVERED');
  });
  it('never regresses and never moves a suspended/terminal shipment', () => {
    expect(autoStatusAfter('LOADED', 'ARRIVAL')).toBeNull();
    expect(autoStatusAfter('SUSPENDED', 'LOADING')).toBeNull();
    expect(autoStatusAfter('CANCELLED', 'LOADING')).toBeNull();
    expect(autoStatusAfter('DELIVERED', 'LOADING')).toBeNull();
  });
  it('legacy fleet statuses (OFFERED, DRAFT) advance into the workflow', () => {
    expect(autoStatusAfter('OFFERED', 'ASSIGN_DRIVER')).toBe('ACCEPTED');
    expect(autoStatusAfter('DRAFT', 'ASSIGN_DRIVER')).toBe('ACCEPTED');
  });
});

describe('statusForDocs', () => {
  it('waits for docs when required, goes to final check when complete or overridden', () => {
    expect(statusForDocs('WEIGHED', true, true, false, false)).toBe('AWAITING_DOCS');
    expect(statusForDocs('AWAITING_DOCS', true, true, true, false)).toBe('FINAL_CHECK');
    expect(statusForDocs('AWAITING_DOCS', true, true, false, true)).toBe('FINAL_CHECK');
    expect(statusForDocs('WEIGHED', true, false, false, false)).toBe('FINAL_CHECK');
  });
  it('does not touch statuses outside the weighed..final-check window', () => {
    expect(statusForDocs('LOADED', false, true, false, false)).toBeNull();
    expect(statusForDocs('READY_TO_DEPART', true, true, false, false)).toBeNull();
    expect(statusForDocs('SUSPENDED', true, true, false, false)).toBeNull();
  });
});

describe('assertStepAllowed', () => {
  it('enforces the strict order of the loading checklist', () => {
    expect(() => assertStepAllowed('CLEANLINESS', base, 'u1')).toThrow(DispatchRuleError);
    expect(() => assertStepAllowed('ARRIVAL', base, 'u1')).not.toThrow();
    const arrived = { ...base, arrived: true };
    expect(() => assertStepAllowed('TARE', arrived, 'u1')).toThrow(/نظافت/);
    const clean = { ...arrived, cleanlinessResult: 'PASS' };
    expect(() => assertStepAllowed('TARE', clean, 'u1')).not.toThrow();
    expect(() => assertStepAllowed('LOADING', clean, 'u1')).toThrow(/وزن خالی/);
    const tared = { ...clean, tareKg: 10000 };
    expect(() => assertStepAllowed('LOADING', tared, 'u1')).not.toThrow();
    expect(() => assertStepAllowed('GROSS', tared, 'u1')).toThrow(/بارگیری/);
  });
  it('failed cleanliness blocks weighing but allows a re-check', () => {
    const failed = { ...base, arrived: true, cleanlinessResult: 'FAIL' };
    expect(() => assertStepAllowed('TARE', failed, 'u1')).toThrow();
    expect(() => assertStepAllowed('CLEANLINESS', failed, 'u1')).not.toThrow();
  });
  it('final check requires a different person than the loader', () => {
    const f = { ...base, grossKg: 30000, netKg: 20000, loaderUserId: 'loader' };
    expect(() => assertStepAllowed('FINAL_CHECK', f, 'loader')).toThrow(/غیر از بارگیرنده/);
    expect(() => assertStepAllowed('FINAL_CHECK', f, 'other')).not.toThrow();
    expect(() => assertFourEyes('a', null)).toThrow();
  });
  it('ready-to-depart is gated by final check, weight confirmation and documents', () => {
    const f = { ...base, finalCheckResult: 'PASS', docsRequired: true, docsComplete: false };
    expect(() => assertStepAllowed('READY', f, 'u')).toThrow(/اسناد/);
    expect(() => assertStepAllowed('READY', { ...f, docsComplete: true }, 'u')).not.toThrow();
    expect(() => assertStepAllowed('READY', { ...f, docsOverridden: true }, 'u')).not.toThrow();
    expect(() => assertStepAllowed('READY', { ...f, docsComplete: true, needsWeighing: true }, 'u')).toThrow(/وزن نهایی/);
    expect(() => assertStepAllowed('READY', { ...f, docsComplete: true, needsWeighing: true, weightConfirmed: true }, 'u')).not.toThrow();
    expect(() => assertStepAllowed('READY', { ...base, finalCheckResult: null }, 'u')).toThrow(/کنترل نهایی/);
  });
  it('departure needs the receipt unless overridden', () => {
    const f = { ...base, readyGranted: true };
    expect(() => assertStepAllowed('DEPART', f, 'u')).toThrow(/رسید/);
    expect(() => assertStepAllowed('DEPART', { ...f, receiptDone: true }, 'u')).not.toThrow();
    expect(() => assertStepAllowed('DEPART', { ...f, receiptOverridden: true }, 'u')).not.toThrow();
    expect(() => assertStepAllowed('DEPART', { ...f, receiptRequiredBeforeDeparture: false }, 'u')).not.toThrow();
  });
  it('blocks every step while suspended or closed', () => {
    expect(() => assertStepAllowed('ARRIVAL', { ...base, status: 'SUSPENDED' }, 'u')).toThrow(/متوقف/);
    expect(() => assertStepAllowed('ARRIVAL', { ...base, status: 'CANCELLED' }, 'u')).toThrow(/بسته/);
  });
});

describe('doc gate and manual change', () => {
  it('doc gate', () => {
    expect(() => assertDocsGate(true, false, false)).toThrow();
    expect(() => assertDocsGate(true, true, false)).not.toThrow();
    expect(() => assertDocsGate(false, false, false)).not.toThrow();
    expect(() => assertDocsGate(true, false, true)).not.toThrow();
  });
  it('manual status change requires a reason and forbids closed/identical/draft targets', () => {
    expect(() => validateManualChange('LOADED', 'SUSPENDED', '')).toThrow(/دلیل/);
    expect(validateManualChange('LOADED', 'SUSPENDED', '  خرابی ماشین ')).toBe('خرابی ماشین');
    expect(() => validateManualChange('DELIVERED', 'IN_TRANSIT', 'x y z')).toThrow();
    expect(() => validateManualChange('LOADED', 'LOADED', 'because')).toThrow();
    expect(() => validateManualChange('LOADED', 'DRAFT', 'because')).toThrow();
    expect(() => validateManualChange('LOADED', 'BOGUS', 'because')).toThrow();
  });
});
