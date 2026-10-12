import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MAX_PINNED_CHATS, buildPushText, deliveryStatus, mediaPreviewLabel, sortConversationList } from './messenger-policy.js';
import { kindForMime, limitFor, magicMatches } from './messenger-media.util.js';
import { MessengerService, type MessengerActor } from './messenger.service.js';

describe('conversation ordering', () => {
  it('puts pinned first (by pin time) then by last activity', () => {
    const out = sortConversationList([
      { id: 'a', pinnedAt: null, lastMessageAt: '2026-01-03' },
      { id: 'b', pinnedAt: '2026-01-02', lastMessageAt: '2026-01-01' },
      { id: 'c', pinnedAt: null, lastMessageAt: '2026-01-05' },
      { id: 'd', pinnedAt: '2026-01-01', lastMessageAt: '2026-01-01' },
    ]);
    expect(out.map((x) => x.id)).toEqual(['d', 'b', 'c', 'a']);
  });
});

describe('delivery status', () => {
  it('maps member receipts to sent/delivered/seen', () => {
    expect(deliveryStatus(5, [])).toBe('sent');
    expect(deliveryStatus(5, [{ lastReadSeq: 0, lastDeliveredSeq: 4 }])).toBe('sent');
    expect(deliveryStatus(5, [{ lastReadSeq: 0, lastDeliveredSeq: 5 }])).toBe('delivered');
    expect(deliveryStatus(5, [{ lastReadSeq: 5, lastDeliveredSeq: 5 }, { lastReadSeq: 2, lastDeliveredSeq: 5 }])).toBe('delivered');
    expect(deliveryStatus(5, [{ lastReadSeq: 5, lastDeliveredSeq: 5 }])).toBe('seen');
  });
});

describe('push text', () => {
  const base = { conversationTitle: 'تیم فروش', senderName: 'علی', text: 'سلام', media: null, hidePreview: false, mentioned: false };
  it('direct: title = sender, body = preview', () => {
    expect(buildPushText({ ...base, conversationType: 'DIRECT' })).toEqual({ title: 'علی', body: 'سلام' });
  });
  it('group: title = group, body prefixed with sender', () => {
    expect(buildPushText({ ...base, conversationType: 'GROUP' })).toEqual({ title: 'تیم فروش', body: 'علی: سلام' });
  });
  it('mention in a group is called out', () => {
    expect(buildPushText({ ...base, conversationType: 'GROUP', mentioned: true }).body).toContain('منشن');
  });
  it('hidePreview never leaks text', () => {
    const r = buildPushText({ ...base, conversationType: 'GROUP', hidePreview: true, mentioned: true });
    expect(r.body).not.toContain('سلام');
    expect(buildPushText({ ...base, conversationType: 'DIRECT', hidePreview: true }).body).toBe('پیام جدید');
  });
  it('labels media', () => {
    expect(mediaPreviewLabel({ kind: 'FILE', mime: 'audio/webm', fileName: 'v.webm' })).toBe('🎤 پیام صوتی');
    expect(mediaPreviewLabel({ kind: 'IMAGE', mime: 'image/png', fileName: 'a.png' })).toBe('📷 تصویر');
    expect(buildPushText({ ...base, text: null, conversationType: 'DIRECT', media: { kind: 'FILE', mime: 'application/pdf', fileName: 'r.pdf' } }).body).toBe('📎 r.pdf');
  });
});

describe('voice messages', () => {
  it('audio webm/ogg/mp4 are accepted with an 18MB limit and signature checks', () => {
    for (const m of ['audio/webm', 'audio/ogg', 'audio/mp4']) {
      expect(kindForMime(m)).toBe('FILE');
      expect(limitFor('FILE', m)).toBe(18 * 1024 * 1024);
    }
    expect(limitFor('FILE', 'application/pdf')).toBe(10 * 1024 * 1024);
    expect(magicMatches('audio/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe(true);
    expect(magicMatches('audio/ogg', Buffer.from('OggS....'))).toBe(true);
    expect(magicMatches('audio/webm', Buffer.from('<html>'))).toBe(false);
  });
});

function env() {
  const member = { id: 'm', conversationId: 'c1', userId: 'u1', role: 'MEMBER', muted: false, lastReadSeq: 0, lastDeliveredSeq: 0, visibleFromSeq: 0, joinedAt: new Date(), pinnedAt: null, archivedAt: null };
  const dup = { id: 'old', conversationId: 'c1', seq: 3, senderId: 'u1', kind: 'TEXT', text: 'hi', replyToId: null, forwardedFromName: null, forwardedFromUserId: null, mediaId: null, mentionIds: [], editedAt: null, deletedForAllAt: null, createdAt: new Date(), clientId: 'cid', media: null, reactions: [] };
  const db = {
    moduleSetting: { findUnique: vi.fn(async () => ({ value: { policy: 'OPEN' } })) },
    user: { findMany: vi.fn(async () => [{ id: 'u1', name: 'n' }]) },
    messengerMember: {
      findUnique: vi.fn(async () => ({ ...member, conversation: { id: 'c1', type: 'GROUP', title: 't', directKey: null, createdById: 'u1', lastSeq: 3, lastMessageAt: new Date(), createdAt: new Date() } })),
      count: vi.fn(async () => MAX_PINNED_CHATS),
      update: vi.fn(async () => ({})),
    },
    messengerMessage: { findFirst: vi.fn(async () => dup), findMany: vi.fn(async () => []) },
  };
  const gateway = { emitToUsers: vi.fn(), isActive: vi.fn(() => true), isOnline: vi.fn(() => false) };
  const service = new MessengerService({} as never, gateway as never, { isConfigured: () => false } as never);
  const actor: MessengerActor = { tenantId: 't', tenantDb: db as never, userId: 'u1', isManager: false };
  return { service, actor, db };
}

describe('chat pin / archive / idempotent send', () => {
  it('refuses pinning beyond the cap, allows unpin', async () => {
    const e = env();
    await expect(e.service.setChatPinned(e.actor, 'c1', true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(e.service.setChatPinned(e.actor, 'c1', false)).resolves.toEqual({ pinned: false });
  });
  it('archiving clears the pin', async () => {
    const e = env();
    await e.service.setChatArchived(e.actor, 'c1', true);
    expect(e.db.messengerMember.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pinnedAt: null }) }));
  });
  it('re-sending the same clientId returns the stored message and does not create a duplicate', async () => {
    const e = env();
    const dto = await e.service.sendMessage(e.actor, 'c1', { text: 'hi', clientId: 'cid' });
    expect(dto.id).toBe('old');
    expect(dto.clientId).toBe('cid');
  });
  it('list after=seq returns ascending newer messages', async () => {
    const e = env();
    await e.service.listMessages(e.actor, 'c1', { after: 2 });
    expect(e.db.messengerMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { seq: 'asc' } }));
  });
});
