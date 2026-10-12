import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MessengerService, type MessengerActor } from './messenger.service.js';

const U1 = 'u1';
const U2 = 'u2';
const U3 = 'u3';

type Msg = Record<string, unknown> & { id: string; conversationId: string; senderId: string };

/** دیتابیس ساختگی کوچک: عضویت‌ها، پیام‌ها و واکنش‌ها در حافظه. */
function makeEnv(opts: { members: Record<string, string[]>; messages?: Msg[]; policy?: string; types?: Record<string, 'DIRECT' | 'GROUP' | 'SAVED'> }) {
  const messages: Msg[] = opts.messages ?? [];
  const reactions: { messageId: string; userId: string; emoji: string }[] = [];
  const created: Msg[] = [];
  const types = opts.types ?? {};
  const convRow = (id: string) => ({ id, type: types[id] ?? 'GROUP', title: 't', directKey: null, createdById: U1, lastSeq: 5, lastMessageAt: new Date(), createdAt: new Date() });
  const memberRow = (conversationId: string, userId: string) => ({ id: `${conversationId}-${userId}`, conversationId, userId, role: 'MEMBER', muted: false, lastReadSeq: 0, lastDeliveredSeq: 0, visibleFromSeq: 0, joinedAt: new Date() });
  const tx = {
    messengerConversation: { update: vi.fn(async () => ({ lastSeq: 6 })) },
    messengerMessage: {
      create: vi.fn(async ({ data }: { data: Msg }) => {
        const m = { ...data, id: `new-${created.length}`, createdAt: new Date(), editedAt: null, deletedForAllAt: null, media: null, reactions: [] } as Msg;
        created.push(m);
        return m;
      }),
    },
    messengerMember: { update: vi.fn(async () => ({})) },
  };
  const db = {
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    moduleSetting: { findUnique: vi.fn(async () => ({ value: { policy: opts.policy ?? 'OPEN' } })) },
    user: {
      findMany: vi.fn(async () => [U1, U2, U3].map((id) => ({ id, name: `name-${id}` }))),
      findUnique: vi.fn(async () => ({ id: U1, status: 'ACTIVE' })),
    },
    userRole: { findMany: vi.fn(async () => []) },
    messengerMember: {
      findUnique: vi.fn(async ({ where }: { where: { conversationId_userId: { conversationId: string; userId: string } } }) => {
        const { conversationId, userId } = where.conversationId_userId;
        if (!(opts.members[conversationId] ?? []).includes(userId)) return null;
        return { ...memberRow(conversationId, userId), conversation: convRow(conversationId) };
      }),
      findMany: vi.fn(async ({ where }: { where: { conversationId: string } }) => (opts.members[where.conversationId] ?? []).map((u) => memberRow(where.conversationId, u))),
    },
    messengerMessage: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => messages.find((m) => m.id === where.id) ?? null),
      findMany: vi.fn(async () => []),
    },
    messengerReaction: {
      findFirst: vi.fn(async ({ where }: { where: { messageId: string; userId: string } }) => reactions.find((r) => r.messageId === where.messageId && r.userId === where.userId) ?? null),
      deleteMany: vi.fn(async ({ where }: { where: { messageId: string; userId: string } }) => {
        for (let i = reactions.length - 1; i >= 0; i--) if (reactions[i].messageId === where.messageId && reactions[i].userId === where.userId) reactions.splice(i, 1);
      }),
      create: vi.fn(async ({ data }: { data: { messageId: string; userId: string; emoji: string } }) => void reactions.push(data)),
      findMany: vi.fn(async ({ where }: { where: { messageId: string } }) => reactions.filter((r) => r.messageId === where.messageId)),
    },
  };
  const gateway = { emitToUsers: vi.fn(), isActive: vi.fn(() => true), isOnline: vi.fn(() => false), setHidden: vi.fn() };
  const control = { tenantMembership: { findMany: vi.fn(async () => []) } };
  const push = { isConfigured: () => false };
  const service = new MessengerService(control as never, gateway as never, push as never);
  const actor = (userId = U1): MessengerActor => ({ tenantId: 't1', tenantDb: db as never, userId, isManager: false });
  return { service, actor, db, gateway, created, reactions };
}

describe('membership scope', () => {
  it('non-members get 404 on every conversation-scoped operation', async () => {
    const env = makeEnv({ members: { c1: [U2, U3] } }); // U1 عضو نیست
    const a = env.actor(U1);
    await expect(env.service.getConversation(a, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.service.listMessages(a, 'c1', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.service.sendMessage(a, 'c1', { text: 'hi' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.service.markRead(a, 'c1', 3)).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.service.setMuted(a, 'c1', true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.service.pin(a, 'c1', 'm1', true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a manager is not special: managers also get 404 on others private chats', async () => {
    const env = makeEnv({ members: { c1: [U2, U3] } });
    const manager = { ...env.actor(U1), isManager: true };
    await expect(env.service.getConversation(manager, 'c1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('messages from a conversation the caller is not in are invisible by message id', async () => {
    const env = makeEnv({ members: { c1: [U2, U3] }, messages: [{ id: 'm1', conversationId: 'c1', senderId: U2, seq: 6, kind: 'TEXT', text: 'x', deletedForAllAt: null }] });
    await expect(env.service.editMessage(env.actor(U1), 'm1', 'y')).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.service.react(env.actor(U1), 'm1', '👍')).rejects.toBeInstanceOf(NotFoundException);
    await expect(env.service.forward(env.actor(U1), 'm1', ['c1'])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only the author can edit', async () => {
    const env = makeEnv({ members: { c1: [U1, U2] }, messages: [{ id: 'm1', conversationId: 'c1', senderId: U2, seq: 6, kind: 'TEXT', text: 'x', deletedForAllAt: null }] });
    await expect(env.service.editMessage(env.actor(U1), 'm1', 'y')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('reply and forward integrity', () => {
  it('rejects a reply to a message from another conversation', async () => {
    const env = makeEnv({ members: { c1: [U1, U2], c2: [U1, U2] }, messages: [{ id: 'other', conversationId: 'c2', senderId: U2, seq: 1, deletedForAllAt: null }] });
    await expect(env.service.sendMessage(env.actor(), 'c1', { text: 'hi', replyToId: 'other' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty messages', async () => {
    const env = makeEnv({ members: { c1: [U1, U2] } });
    await expect(env.service.sendMessage(env.actor(), 'c1', { text: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forward keeps the ORIGINAL author name, drops reply links and requires membership of every target', async () => {
    const src = { id: 'm1', conversationId: 'c1', senderId: U2, seq: 6, kind: 'TEXT', text: 'سلام', replyToId: 'x', forwardedFromName: null, forwardedFromUserId: null, mediaId: null, media: null, reactions: [], deletedForAllAt: null };
    const env = makeEnv({ members: { c1: [U1, U2], c2: [U1, U3] }, messages: [src] });
    const r = await env.service.forward(env.actor(U1), 'm1', ['c2']);
    expect(r.forwarded).toBe(1);
    expect(env.created[0]).toMatchObject({ conversationId: 'c2', senderId: U1, forwardedFromName: 'name-u2', forwardedFromUserId: U2, text: 'سلام' });
    expect(env.created[0].replyToId).toBeNull();
    // مقصد ناعضو → ۴۰۴ و چیزی ساخته نمی‌شود
    const env2 = makeEnv({ members: { c1: [U1, U2], c3: [U2, U3] }, messages: [src] });
    await expect(env2.service.forward(env2.actor(U1), 'm1', ['c3'])).rejects.toBeInstanceOf(NotFoundException);
    expect(env2.created).toHaveLength(0);
  });

  it('re-forwarding keeps the first author, not the forwarder', async () => {
    const src = { id: 'm2', conversationId: 'c1', senderId: U2, seq: 6, kind: 'TEXT', text: 't', forwardedFromName: 'اصلی', forwardedFromUserId: U3, mediaId: null, media: null, reactions: [], deletedForAllAt: null };
    const env = makeEnv({ members: { c1: [U1, U2], c2: [U1, U3] }, messages: [src] });
    await env.service.forward(env.actor(U1), 'm2', ['c2']);
    expect(env.created[0]).toMatchObject({ forwardedFromName: 'اصلی', forwardedFromUserId: U3 });
  });

  it('a deleted message cannot be forwarded', async () => {
    const src = { id: 'm3', conversationId: 'c1', senderId: U2, seq: 6, kind: 'TEXT', text: null, media: null, reactions: [], deletedForAllAt: new Date() };
    const env = makeEnv({ members: { c1: [U1, U2], c2: [U1, U3] }, messages: [src] });
    await expect(env.service.forward(env.actor(U1), 'm3', ['c2'])).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('reactions', () => {
  const src = { id: 'm1', conversationId: 'c1', senderId: U2, seq: 6, kind: 'TEXT', text: 'x', media: null, reactions: [], deletedForAllAt: null };

  it('toggles on/off, replaces with a different emoji and counts per user', async () => {
    const env = makeEnv({ members: { c1: [U1, U2] }, messages: [src] });
    let r = await env.service.react(env.actor(U1), 'm1', '👍');
    expect(r.reactions).toEqual([{ emoji: '👍', userIds: [U1] }]);
    r = await env.service.react(env.actor(U2), 'm1', '👍');
    expect(r.reactions).toEqual([{ emoji: '👍', userIds: [U1, U2] }]);
    r = await env.service.react(env.actor(U1), 'm1', '👍');
    expect(r.reactions).toEqual([{ emoji: '👍', userIds: [U2] }]);
    r = await env.service.react(env.actor(U2), 'm1', '❤️');
    expect(r.reactions).toEqual([{ emoji: '❤️', userIds: [U2] }]);
  });

  it('rejects emojis outside the allowlist', async () => {
    const env = makeEnv({ members: { c1: [U1, U2] }, messages: [src] });
    await expect(env.service.react(env.actor(U1), 'm1', '<script>')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('direct-message policy at send time', () => {
  it('blocks sending in a DIRECT chat when MANAGERS_INITIATE and a non-manager created it', async () => {
    const env = makeEnv({ members: { d1: [U1, U2] }, policy: 'MANAGERS_INITIATE', types: { d1: 'DIRECT' } });
    await expect(env.service.sendMessage(env.actor(U1), 'd1', { text: 'hi' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows sending under OPEN', async () => {
    const env = makeEnv({ members: { d1: [U1, U2] }, types: { d1: 'DIRECT' } });
    const dto = await env.service.sendMessage(env.actor(U1), 'd1', { text: 'hi' });
    expect(dto.text).toBe('hi');
    expect(env.gateway.emitToUsers).toHaveBeenCalledWith('t1', [U1, U2], 'message:new', expect.anything());
  });
});
