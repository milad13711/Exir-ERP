import { describe, expect, it } from 'vitest';
import {
  ALLOWED_REACTIONS,
  SlidingWindowLimiter,
  canCreateGroup,
  canDeleteForAll,
  canRemoveMember,
  canSendDirect,
  canStartDirect,
  directKeyFor,
  nextReactionState,
  normalizeSettings,
  pickNextOwner,
  snippet,
} from './messenger-policy.js';

const pair = (o: Partial<{ actorIsManager: boolean; targetIsManager: boolean; sharesRole: boolean }> = {}) => ({ actorIsManager: false, targetIsManager: false, sharesRole: false, ...o });

describe('messenger policy', () => {
  it('OPEN lets everyone start a direct chat', () => {
    expect(canStartDirect('OPEN', pair())).toBe(true);
  });

  it('MANAGERS_AND_SHARED_ROLE: only managers or same-role peers', () => {
    expect(canStartDirect('MANAGERS_AND_SHARED_ROLE', pair())).toBe(false);
    expect(canStartDirect('MANAGERS_AND_SHARED_ROLE', pair({ targetIsManager: true }))).toBe(true);
    expect(canStartDirect('MANAGERS_AND_SHARED_ROLE', pair({ actorIsManager: true }))).toBe(true);
    expect(canStartDirect('MANAGERS_AND_SHARED_ROLE', pair({ sharesRole: true }))).toBe(true);
  });

  it('MANAGERS_INITIATE: members cannot start but can reply to a manager-created chat', () => {
    expect(canStartDirect('MANAGERS_INITIATE', pair())).toBe(false);
    expect(canStartDirect('MANAGERS_INITIATE', pair({ actorIsManager: true }))).toBe(true);
    expect(canSendDirect('MANAGERS_INITIATE', { ...pair(), createdByManager: false })).toBe(false);
    expect(canSendDirect('MANAGERS_INITIATE', { ...pair(), createdByManager: true })).toBe(true);
    expect(canSendDirect('MANAGERS_INITIATE', { ...pair({ actorIsManager: true }), createdByManager: false })).toBe(true);
  });

  it('existing chats follow a tightened shared-role policy too', () => {
    expect(canSendDirect('MANAGERS_AND_SHARED_ROLE', { ...pair(), createdByManager: false })).toBe(false);
  });

  it('group creation can be restricted to managers', () => {
    expect(canCreateGroup('EVERYONE', false)).toBe(true);
    expect(canCreateGroup('MANAGERS', false)).toBe(false);
    expect(canCreateGroup('MANAGERS', true)).toBe(true);
  });

  it('settings normalisation falls back to permissive defaults', () => {
    expect(normalizeSettings(null)).toEqual({ policy: 'OPEN', groupCreation: 'EVERYONE', hidePreview: false, retentionDays: null, showPresence: true });
    expect(normalizeSettings({ policy: 'bogus', retentionDays: -5, hidePreview: true }).policy).toBe('OPEN');
    expect(normalizeSettings({ retentionDays: 30.7 }).retentionDays).toBe(30);
    expect(normalizeSettings({ retentionDays: 0 }).retentionDays).toBeNull();
  });

  it('direct key is symmetric', () => {
    expect(directKeyFor('b', 'a')).toBe(directKeyFor('a', 'b'));
  });
});

describe('group roles', () => {
  it('owner removes anyone but themselves-as-owner; admin removes only members', () => {
    expect(canRemoveMember('OWNER', 'ADMIN')).toBe(true);
    expect(canRemoveMember('OWNER', 'OWNER')).toBe(false);
    expect(canRemoveMember('ADMIN', 'MEMBER')).toBe(true);
    expect(canRemoveMember('ADMIN', 'ADMIN')).toBe(false);
    expect(canRemoveMember('MEMBER', 'MEMBER')).toBe(false);
  });

  it('delete-for-everyone: sender always, group admins on others, nobody in direct chats', () => {
    expect(canDeleteForAll({ isSender: true, conversationType: 'DIRECT', role: 'MEMBER' })).toBe(true);
    expect(canDeleteForAll({ isSender: false, conversationType: 'DIRECT', role: 'MEMBER' })).toBe(false);
    expect(canDeleteForAll({ isSender: false, conversationType: 'GROUP', role: 'ADMIN' })).toBe(true);
    expect(canDeleteForAll({ isSender: false, conversationType: 'GROUP', role: 'MEMBER' })).toBe(false);
  });

  it('ownership passes to the oldest admin, else the oldest member', () => {
    const d = (n: number) => new Date(2026, 0, n);
    expect(pickNextOwner([{ userId: 'm1', role: 'MEMBER', joinedAt: d(1) }, { userId: 'a1', role: 'ADMIN', joinedAt: d(3) }, { userId: 'a2', role: 'ADMIN', joinedAt: d(2) }])).toBe('a2');
    expect(pickNextOwner([{ userId: 'm2', role: 'MEMBER', joinedAt: d(5) }, { userId: 'm1', role: 'MEMBER', joinedAt: d(1) }])).toBe('m1');
    expect(pickNextOwner([])).toBeNull();
  });
});

describe('reactions toggle', () => {
  it('same emoji removes, different emoji replaces, first adds', () => {
    expect(nextReactionState(null, '👍')).toEqual({ remove: null, add: '👍' });
    expect(nextReactionState('👍', '👍')).toEqual({ remove: '👍', add: null });
    expect(nextReactionState('👍', '❤️')).toEqual({ remove: '👍', add: '❤️' });
  });

  it('quick like emojis are in the allowlist', () => {
    expect(ALLOWED_REACTIONS).toContain('❤️');
    expect(ALLOWED_REACTIONS).toContain('👍');
  });
});

describe('helpers', () => {
  it('rate limiter blocks over the window and recovers', () => {
    const l = new SlidingWindowLimiter(2, 1000);
    expect(l.take('u', 0)).toBe(true);
    expect(l.take('u', 10)).toBe(true);
    expect(l.take('u', 20)).toBe(false);
    expect(l.take('other', 20)).toBe(true);
    expect(l.take('u', 1500)).toBe(true);
  });

  it('snippet collapses whitespace and truncates', () => {
    expect(snippet('a   b\n c')).toBe('a b c');
    expect(snippet('x'.repeat(200), 10)).toHaveLength(10);
  });
});
