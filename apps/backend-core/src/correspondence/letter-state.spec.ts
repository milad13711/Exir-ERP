import { describe, expect, it } from 'vitest';
import { LETTER_STATUSES, type LetterStatus } from './correspondence.constants.js';
import { canCreateCorrection, canParaph, canRefer, canTransition, isArchivable, isEditable, nextStatus } from './letter-state.js';

describe('outgoing workflow', () => {
  it('happy path DRAFT → PENDING_SIGNATURE → ISSUED → SENT → DELIVERED', () => {
    expect(nextStatus('OUTGOING', 'DRAFT', 'submit')).toBe('PENDING_SIGNATURE');
    expect(nextStatus('OUTGOING', 'PENDING_SIGNATURE', 'sign')).toBe('ISSUED');
    expect(nextStatus('OUTGOING', 'ISSUED', 'send')).toBe('SENT');
    expect(nextStatus('OUTGOING', 'SENT', 'deliver')).toBe('DELIVERED');
  });
  it('optional review stage', () => {
    expect(nextStatus('OUTGOING', 'DRAFT', 'submit_review')).toBe('PENDING_REVIEW');
    expect(nextStatus('OUTGOING', 'PENDING_REVIEW', 'review_approve')).toBe('PENDING_SIGNATURE');
    expect(nextStatus('OUTGOING', 'PENDING_REVIEW', 'review_changes')).toBe('RETURNED_FOR_EDIT');
  });
  it('return / reject / reopen', () => {
    expect(nextStatus('OUTGOING', 'PENDING_SIGNATURE', 'return')).toBe('RETURNED_FOR_EDIT');
    expect(nextStatus('OUTGOING', 'RETURNED_FOR_EDIT', 'submit')).toBe('PENDING_SIGNATURE');
    expect(nextStatus('OUTGOING', 'PENDING_SIGNATURE', 'reject')).toBe('REJECTED');
    expect(nextStatus('OUTGOING', 'REJECTED', 'reopen')).toBe('DRAFT');
  });
  it('cannot skip signature or sign twice', () => {
    expect(nextStatus('OUTGOING', 'DRAFT', 'sign')).toBeNull();
    expect(nextStatus('OUTGOING', 'DRAFT', 'send')).toBeNull();
    expect(nextStatus('OUTGOING', 'ISSUED', 'sign')).toBeNull();
    expect(nextStatus('OUTGOING', 'ISSUED', 'submit')).toBeNull();
    expect(nextStatus('OUTGOING', 'SENT', 'send')).toBeNull();
  });
  it('internal letters go ISSUED → DELIVERED directly and never SENT', () => {
    expect(nextStatus('INTERNAL', 'ISSUED', 'send')).toBeNull();
    expect(nextStatus('INTERNAL', 'ISSUED', 'deliver')).toBe('DELIVERED');
  });
});

describe('incoming workflow', () => {
  it('REGISTERED → REFERRED → IN_PROGRESS → ANSWERED / CLOSED', () => {
    expect(nextStatus('INCOMING', 'REGISTERED', 'refer')).toBe('REFERRED');
    expect(nextStatus('INCOMING', 'REFERRED', 'start')).toBe('IN_PROGRESS');
    expect(nextStatus('INCOMING', 'IN_PROGRESS', 'answer')).toBe('ANSWERED');
    expect(nextStatus('INCOMING', 'ANSWERED', 'close')).toBe('CLOSED');
    expect(nextStatus('INCOMING', 'REGISTERED', 'close')).toBe('CLOSED');
    expect(nextStatus('INCOMING', 'CLOSED', 'reopen')).toBe('IN_PROGRESS');
  });
  it('incoming never uses signature actions', () => {
    for (const a of ['submit', 'sign', 'send', 'deliver', 'return', 'reject'] as const) {
      for (const s of LETTER_STATUSES) expect(nextStatus('INCOMING', s, a)).toBeNull();
    }
  });
});

describe('void', () => {
  it('any non-void status can be voided; void is terminal', () => {
    for (const s of LETTER_STATUSES.filter((x) => x !== 'VOID')) expect(canTransition('OUTGOING', s as LetterStatus, 'void')).toBe(true);
    for (const a of ['submit', 'sign', 'send', 'deliver', 'refer', 'close', 'reopen', 'void'] as const) {
      expect(nextStatus('OUTGOING', 'VOID', a)).toBeNull();
      expect(nextStatus('INCOMING', 'VOID', a)).toBeNull();
    }
  });
});

describe('guards', () => {
  it('edit is allowed only before signing (outgoing) and before close (incoming)', () => {
    expect(isEditable('OUTGOING', 'DRAFT')).toBe(true);
    expect(isEditable('OUTGOING', 'RETURNED_FOR_EDIT')).toBe(true);
    for (const s of ['PENDING_REVIEW', 'PENDING_SIGNATURE', 'ISSUED', 'SENT', 'DELIVERED', 'VOID', 'REJECTED'] as const) expect(isEditable('OUTGOING', s)).toBe(false);
    expect(isEditable('INCOMING', 'REGISTERED')).toBe(true);
    expect(isEditable('INCOMING', 'CLOSED')).toBe(false);
    expect(isEditable('INCOMING', 'VOID')).toBe(false);
  });
  it('corrections only for issued outgoing/internal', () => {
    expect(canCreateCorrection('OUTGOING', 'ISSUED')).toBe(true);
    expect(canCreateCorrection('OUTGOING', 'DRAFT')).toBe(false);
    expect(canCreateCorrection('INCOMING', 'REGISTERED')).toBe(false);
  });
  it('archive/refer/paraph rules', () => {
    expect(isArchivable('OUTGOING', 'DRAFT')).toBe(false);
    expect(isArchivable('OUTGOING', 'DELIVERED')).toBe(true);
    expect(isArchivable('INCOMING', 'IN_PROGRESS')).toBe(false);
    expect(isArchivable('INCOMING', 'CLOSED')).toBe(true);
    expect(canRefer('INCOMING', 'CLOSED')).toBe(false);
    expect(canRefer('INCOMING', 'REGISTERED')).toBe(true);
    expect(canParaph('VOID')).toBe(false);
    expect(canParaph('ISSUED')).toBe(true);
  });
});
