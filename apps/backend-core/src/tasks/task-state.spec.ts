import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATUSES,
  availableActions,
  canTransition,
  nextStatus,
  requiresApproval,
  TaskTransitionError,
  type TaskAction,
  type TaskStatusValue,
} from './task-state.js';

describe('task state machine', () => {
  it('follows the happy path NEW → SEEN → IN_PROGRESS → DONE → APPROVED', () => {
    let s: TaskStatusValue = 'NEW';
    for (const [a, to] of [['SEE', 'SEEN'], ['START', 'IN_PROGRESS'], ['SUBMIT', 'DONE'], ['APPROVE', 'APPROVED']] as Array<[TaskAction, TaskStatusValue]>) {
      s = nextStatus(s, a);
      expect(s).toBe(to);
    }
  });

  it('return-for-fix loops back to work and can be resubmitted', () => {
    expect(nextStatus('DONE', 'RETURN')).toBe('RETURNED_FOR_FIX');
    expect(nextStatus('RETURNED_FOR_FIX', 'START')).toBe('IN_PROGRESS');
    expect(nextStatus('RETURNED_FOR_FIX', 'SUBMIT')).toBe('DONE');
  });

  it('problem report blocks work until the manager resolves it', () => {
    expect(nextStatus('IN_PROGRESS', 'REPORT_PROBLEM')).toBe('HAS_PROBLEM');
    expect(canTransition('HAS_PROBLEM', 'SUBMIT')).toBe(false);
    expect(canTransition('HAS_PROBLEM', 'START')).toBe(false);
    expect(nextStatus('HAS_PROBLEM', 'RESOLVE_PROBLEM')).toBe('IN_PROGRESS');
  });

  it('rejects illegal transitions with TaskTransitionError', () => {
    expect(() => nextStatus('NEW', 'APPROVE')).toThrow(TaskTransitionError);
    expect(() => nextStatus('APPROVED', 'START')).toThrow(TaskTransitionError);
    expect(() => nextStatus('CANCELLED', 'SUBMIT')).toThrow(TaskTransitionError);
    expect(() => nextStatus('DONE', 'START')).toThrow(TaskTransitionError);
    expect(() => nextStatus('IN_PROGRESS', 'RETURN')).toThrow(TaskTransitionError);
  });

  it('expiry only affects work-in-progress tasks and resume restores the prior status', () => {
    expect(nextStatus('IN_PROGRESS', 'EXPIRE')).toBe('EXPIRED');
    expect(canTransition('DONE', 'EXPIRE')).toBe(false);
    expect(canTransition('HAS_PROBLEM', 'EXPIRE')).toBe(false);
    expect(canTransition('APPROVED', 'EXPIRE')).toBe(false);
    expect(nextStatus('EXPIRED', 'RESUME', { expiredFrom: 'IN_PROGRESS' })).toBe('IN_PROGRESS');
    expect(nextStatus('EXPIRED', 'RESUME', { expiredFrom: null })).toBe('NEW');
    expect(nextStatus('EXPIRED', 'RESUME', { expiredFrom: 'OPEN' })).toBe('NEW');
    expect(nextStatus('EXPIRED', 'START')).toBe('IN_PROGRESS');
  });

  it('cancel works from any open state but not once closed; reassign resets to NEW', () => {
    for (const s of ACTIVE_STATUSES) expect(canTransition(s, 'CANCEL')).toBe(true);
    expect(canTransition('DONE', 'CANCEL')).toBe(true);
    expect(canTransition('APPROVED', 'CANCEL')).toBe(false);
    expect(canTransition('CANCELLED', 'CANCEL')).toBe(false);
    expect(nextStatus('IN_PROGRESS', 'REASSIGN')).toBe('NEW');
    expect(canTransition('APPROVED', 'REASSIGN')).toBe(false);
    expect(nextStatus('CANCELLED', 'REOPEN')).toBe('NEW');
  });

  it('legacy OPEN behaves like NEW', () => {
    expect(nextStatus('OPEN', 'SEE')).toBe('SEEN');
    expect(nextStatus('OPEN', 'START')).toBe('IN_PROGRESS');
  });

  it('available actions are split by role', () => {
    expect(availableActions('NEW', { manager: false, assignee: true })).toEqual(expect.arrayContaining(['SEE', 'START', 'SUBMIT', 'REPORT_PROBLEM']));
    expect(availableActions('NEW', { manager: false, assignee: true })).not.toContain('CANCEL');
    expect(availableActions('DONE', { manager: true, assignee: false })).toEqual(expect.arrayContaining(['APPROVE', 'RETURN', 'CANCEL']));
    expect(availableActions('DONE', { manager: true, assignee: false })).not.toContain('SUBMIT');
    expect(availableActions('IN_PROGRESS', { manager: false, assignee: false })).toEqual([]);
  });

  it('personal tasks and system-created tasks skip approval', () => {
    expect(requiresApproval('u1', ['u1'])).toBe(false);
    expect(requiresApproval(null, ['u1'])).toBe(false);
    expect(requiresApproval('u1', ['u2'])).toBe(true);
    expect(requiresApproval('u1', ['u1', 'u2'])).toBe(true);
  });
});
