import { describe, expect, it } from 'vitest';
import { canManageTask, isTaskAssignee, resolveTaskRole, taskScopeWhere } from './task-scope.js';

describe('task scope', () => {
  it('managers see everything (empty where)', () => {
    expect(taskScopeWhere(true, 'u1')).toEqual({});
    expect(taskScopeWhere(true, null)).toEqual({});
  });

  it('non-managers see created or (published) assigned tasks only', () => {
    const w = taskScopeWhere(false, 'u1') as { OR: Array<Record<string, unknown>> };
    expect(w.OR).toContainEqual({ createdByUserId: 'u1' });
    expect(w.OR).toContainEqual({ isPublished: true, assignedUserId: 'u1' });
    expect(w.OR).toContainEqual({ isPublished: true, assignees: { some: { userId: 'u1' } } });
    // a scheduled (unpublished) task must NOT be reachable through the assignee clauses
    for (const clause of w.OR.filter((c) => !('createdByUserId' in c))) expect(clause.isPublished).toBe(true);
  });

  it('an unknown user (e.g. API key without tenant user) matches nothing', () => {
    expect(taskScopeWhere(false, null)).toEqual({ id: '__none__' });
  });

  it('role resolution: legacy assignedUserId counts as assignee; creator/manager can manage', () => {
    const task = { createdByUserId: 'boss', assignedUserId: 'legacy', assignees: [{ userId: 'a2' }] };
    expect(isTaskAssignee(task, 'legacy')).toBe(true);
    expect(isTaskAssignee(task, 'a2')).toBe(true);
    expect(isTaskAssignee(task, 'x')).toBe(false);
    expect(isTaskAssignee(task, null)).toBe(false);
    expect(canManageTask(resolveTaskRole(task, 'boss', false))).toBe(true);
    expect(canManageTask(resolveTaskRole(task, 'a2', false))).toBe(false);
    expect(canManageTask(resolveTaskRole(task, 'a2', true))).toBe(true);
  });
});
