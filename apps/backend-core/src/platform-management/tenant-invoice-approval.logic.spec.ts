import { describe, expect, it } from 'vitest';
import { applyLineEdits, describeLines, INVOICE_APPROVAL_DEFAULTS, normalizeInvoiceApprovalSettings, requiresApproval } from './tenant-invoice-approval.logic.js';

describe('requiresApproval', () => {
  const on = INVOICE_APPROVAL_DEFAULTS;
  it('auto invoices wait for approval by default', () => expect(requiresApproval('AUTO', on, true)).toBe(true));
  it('manager-issued and checkout invoices are pre-approved', () => {
    expect(requiresApproval('MANUAL', on, true)).toBe(false);
    expect(requiresApproval('CHECKOUT', on, true)).toBe(false);
  });
  it('staff invoices only when the toggle is on', () => {
    expect(requiresApproval('STAFF', on, true)).toBe(false);
    expect(requiresApproval('STAFF', { ...on, requireForStaff: true }, true)).toBe(true);
  });
  it('turning the setting off restores the old behaviour', () => expect(requiresApproval('AUTO', { ...on, requireForAuto: false }, true)).toBe(false));
  it('never holds an invoice when there is no parent tenant to approve it', () => expect(requiresApproval('AUTO', on, false)).toBe(false));
  it('normalizes junk', () => expect(normalizeInvoiceApprovalSettings({ requireForAuto: 'x' })).toEqual(on));
});

describe('line edits', () => {
  const items = [{ moduleCode: 'crm', moduleName: 'CRM', billingMode: 'MONTHLY', amount: 100 }, { moduleCode: 'hr', moduleName: 'HR', billingMode: 'YEARLY', amount: 500 }];
  it('recomputes the total from lines and ignores bad indexes/amounts', () => {
    const r = applyLineEdits(items, [{ index: 1, amount: 400 }, { index: 9, amount: 1 }, { index: 0, amount: -5 }]);
    expect(r.amount).toBe(500);
    expect(r.items[1]!.amount).toBe(400);
    expect(items[1]!.amount).toBe(500);
  });
  it('describes lines', () => expect(describeLines(items)).toContain('CRM'));
});
