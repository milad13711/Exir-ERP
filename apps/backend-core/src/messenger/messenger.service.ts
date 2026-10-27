import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { PushNotificationsService } from '../notifications/push-notifications.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { MessengerGateway } from './messenger.gateway.js';
import {
  ALLOWED_REACTIONS,
  DEFAULT_MESSENGER_SETTINGS,
  SlidingWindowLimiter,
  canCreateGroup,
  canDeleteForAll,
  canManageMembers,
  canRemoveMember,
  canSendDirect,
  canStartDirect,
  buildPushText,
  deliveryStatus,
  directKeyFor,
  MAX_PINNED_CHATS,
  sortConversationList,
  nextReactionState,
  normalizeSettings,
  pickNextOwner,
  savedKeyFor,
  snippet,
  type MemberRole,
  type MessengerSettings,
} from './messenger-policy.js';
import { hoursUntilExpiry, isMediaExpired } from './messenger-media.util.js';
import type { UpdateSettingsDto } from './dto/messenger.dto.js';

export type MessengerActor = { tenantId: string; tenantDb: TenantPrismaClient; userId: string; isManager: boolean };

type Db = TenantPrismaClient;

type MemberRow = {
  id: string;
  conversationId: string;
  userId: string;
  role: MemberRole;
  muted: boolean;
  lastReadSeq: number;
  lastDeliveredSeq: number;
  visibleFromSeq: number;
  joinedAt: Date;
  pinnedAt?: Date | null;
  archivedAt?: Date | null;
};
type ConversationRow = {
  id: string;
  type: 'DIRECT' | 'GROUP' | 'SAVED';
  title: string | null;
  directKey: string | null;
  createdById: string;
  lastSeq: number;
  lastMessageAt: Date;
  createdAt: Date;
};
type MediaRow = { id: string; kind: 'IMAGE' | 'FILE' | 'VIDEO'; mime: string; fileName: string; size: number; expiresAt: Date; purgedAt: Date | null };
type MessageRow = {
  id: string;
  conversationId: string;
  seq: number;
  senderId: string;
  kind: 'TEXT' | 'MEDIA' | 'SYSTEM';
  text: string | null;
  replyToId: string | null;
  forwardedFromName: string | null;
  forwardedFromUserId: string | null;
  mediaId: string | null;
  mentionIds: string[];
  editedAt: Date | null;
  deletedForAllAt: Date | null;
  createdAt: Date;
  clientId?: string | null;
  media?: MediaRow | null;
  reactions?: { messageId: string; userId: string; emoji: string }[];
};

export type MessageDto = {
  id: string;
  conversationId: string;
  seq: number;
  senderId: string;
  senderName: string;
  kind: 'TEXT' | 'MEDIA' | 'SYSTEM';
  text: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  replyTo: { id: string; senderName: string; text: string; hasMedia: boolean; deleted: boolean } | null;
  forwardedFrom: string | null;
  media: { id: string; kind: string; mime: string; fileName: string; size: number; expiresAt: string; expired: boolean; hoursLeft: number } | null;
  reactions: { emoji: string; userIds: string[] }[];
  mentionIds: string[];
  clientId: string | null;
};

const MAX_TEXT = 4000;
const NOT_FOUND = 'گفتگو یافت نشد';

@Injectable()
export class MessengerService {
  private readonly logger = new Logger('MessengerService');
  private readonly sendLimiter = new SlidingWindowLimiter(30, 10_000);
  private readonly groupLimiter = new SlidingWindowLimiter(10, 3_600_000);

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly gateway: MessengerGateway,
    private readonly push: PushNotificationsService,
  ) {}

  // ── actor / تنظیمات ─────────────────────────────────────────────────

  async actorOf(ctx: TenantRequestContext): Promise<MessengerActor> {
    if (ctx.auth.type === 'api_key') throw new ForbiddenException('پیام‌رسان فقط برای کاربران وارد‌شده در دسترس است');
    const user = await ctx.tenantDb.user.findUnique({ where: { globalUserId: ctx.auth.sub }, select: { id: true } });
    if (!user) throw new NotFoundException('کاربر در این محیط کاری یافت نشد');
    return { tenantId: ctx.tenantId, tenantDb: ctx.tenantDb, userId: user.id, isManager: ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN' };
  }

  async getSettings(db: Db): Promise<MessengerSettings> {
    const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'messenger', key: 'settings' } } });
    return normalizeSettings(row?.value ?? DEFAULT_MESSENGER_SETTINGS);
  }

  async updateSettings(actor: MessengerActor, dto: UpdateSettingsDto): Promise<MessengerSettings> {
    if (!actor.isManager) throw new ForbiddenException('فقط مدیران می‌توانند تنظیمات پیام‌رسان را تغییر دهند');
    const current = await this.getSettings(actor.tenantDb);
    const next = normalizeSettings({
      ...current,
      ...(dto.policy !== undefined ? { policy: dto.policy } : {}),
      ...(dto.groupCreation !== undefined ? { groupCreation: dto.groupCreation } : {}),
      ...(dto.hidePreview !== undefined ? { hidePreview: dto.hidePreview } : {}),
      ...(dto.showPresence !== undefined ? { showPresence: dto.showPresence } : {}),
      ...(dto.retentionDays !== undefined ? { retentionDays: dto.retentionDays } : {}),
    });
    await actor.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: 'messenger', key: 'settings' } },
      create: { moduleCode: 'messenger', key: 'settings', value: next },
      update: { value: next },
    });
    return next;
  }

  /** شناسه‌ی کاربران تننت که مدیر (OWNER/ADMIN عضویت) هستند. */
  async managerIds(actor: Pick<MessengerActor, 'tenantId' | 'tenantDb'>): Promise<Set<string>> {
    const memberships = await this.controlDb.tenantMembership.findMany({
      where: { tenantId: actor.tenantId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { globalUserId: true },
    });
    if (memberships.length === 0) return new Set();
    const users = await actor.tenantDb.user.findMany({ where: { globalUserId: { in: memberships.map((m) => m.globalUserId) } }, select: { id: true } });
    return new Set(users.map((u) => u.id));
  }

  private async names(db: Db, ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const users = await db.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  // ── عضویت (هر مسیر) ─────────────────────────────────────────────────

  /** عضو نبودن = ۴۰۴ (وجود گفتگو برای غیرعضو فاش نمی‌شود). */
  async requireMember(actor: MessengerActor, conversationId: string): Promise<{ conversation: ConversationRow; member: MemberRow }> {
    const member = (await actor.tenantDb.messengerMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: actor.userId } },
      include: { conversation: true },
    })) as (MemberRow & { conversation: ConversationRow }) | null;
    if (!member) throw new NotFoundException(NOT_FOUND);
    const { conversation, ...m } = member;
    return { conversation, member: m };
  }

  private async memberIds(db: Db, conversationId: string): Promise<string[]> {
    return (await db.messengerMember.findMany({ where: { conversationId }, select: { userId: true } })).map((m) => m.userId);
  }

  private async sharesRole(db: Db, a: string, b: string): Promise<boolean> {
    const rows = await db.userRole.findMany({ where: { userId: { in: [a, b] } }, select: { userId: true, roleId: true } });
    const aRoles = new Set(rows.filter((r) => r.userId === a).map((r) => r.roleId));
    return rows.some((r) => r.userId === b && aRoles.has(r.roleId));
  }

  private async pairContext(actor: MessengerActor, targetId: string) {
    const managers = await this.managerIds(actor);
    return {
      actorIsManager: actor.isManager || managers.has(actor.userId),
      targetIsManager: managers.has(targetId),
      sharesRole: await this.sharesRole(actor.tenantDb, actor.userId, targetId),
      managers,
    };
  }

  // ── مخاطبین ─────────────────────────────────────────────────────────

  async contacts(actor: MessengerActor) {
    const [users, settings, managers, myRoles, presence] = await Promise.all([
      actor.tenantDb.user.findMany({
        where: { status: { not: 'DISABLED' }, id: { not: actor.userId } },
        select: { id: true, name: true, roles: { select: { roleId: true, role: { select: { name: true } } } } },
        orderBy: { name: 'asc' },
      }),
      this.getSettings(actor.tenantDb),
      this.managerIds(actor),
      actor.tenantDb.userRole.findMany({ where: { userId: actor.userId }, select: { roleId: true } }),
      actor.tenantDb.messengerPresence.findMany(),
    ]);
    const mine = new Set(myRoles.map((r) => r.roleId));
    const presenceBy = new Map(presence.map((p) => [p.userId, p]));
    return users.map((u) => {
      const shares = u.roles.some((r) => mine.has(r.roleId));
      const p = presenceBy.get(u.id);
      return {
        id: u.id,
        name: u.name,
        roleTitle: u.roles.map((r) => r.role.name).join('، ') || null,
        isManager: managers.has(u.id),
        canMessage: canStartDirect(settings.policy, { actorIsManager: actor.isManager, targetIsManager: managers.has(u.id), sharesRole: shares }),
        ...this.presenceOf(actor.tenantId, u.id, settings, p),
      };
    });
  }

  private presenceOf(tenantId: string, userId: string, settings: MessengerSettings, p?: { hidden: boolean; lastSeenAt: Date } | null) {
    if (!settings.showPresence || p?.hidden) return { online: false, lastSeenAt: null as string | null };
    return { online: this.gateway.isOnline(tenantId, userId), lastSeenAt: p?.lastSeenAt.toISOString() ?? null };
  }

  async setHidden(actor: MessengerActor, hidden: boolean) {
    await actor.tenantDb.messengerPresence.upsert({ where: { userId: actor.userId }, create: { userId: actor.userId, hidden }, update: { hidden } });
    this.gateway.setHidden(actor.tenantId, actor.userId, hidden);
    return { hidden };
  }

  async myPresence(actor: MessengerActor) {
    const p = await actor.tenantDb.messengerPresence.findUnique({ where: { userId: actor.userId } });
    return { hidden: p?.hidden ?? false };
  }

  // ── گفتگوها ─────────────────────────────────────────────────────────

  async ensureSaved(actor: MessengerActor) {
    const key = savedKeyFor(actor.userId);
    let conv = await actor.tenantDb.messengerConversation.findUnique({ where: { directKey: key } });
    if (!conv) {
      try {
        conv = await actor.tenantDb.messengerConversation.create({
          data: { type: 'SAVED', title: 'ذخیره‌شده‌ها', directKey: key, createdById: actor.userId, members: { create: { userId: actor.userId, role: 'OWNER' } } },
        });
      } catch {
        conv = await actor.tenantDb.messengerConversation.findUnique({ where: { directKey: key } });
        if (!conv) throw new ConflictException('ساخت ذخیره‌شده‌ها ناموفق بود');
      }
    }
    return conv;
  }

  async openDirect(actor: MessengerActor, targetId: string) {
    if (targetId === actor.userId) return this.getConversation(actor, (await this.ensureSaved(actor)).id);
    const target = await actor.tenantDb.user.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
    if (!target || target.status === 'DISABLED') throw new NotFoundException('کاربر یافت نشد');
    const key = directKeyFor(actor.userId, targetId);
    let conv = await actor.tenantDb.messengerConversation.findUnique({ where: { directKey: key } });
    if (!conv) {
      const [settings, pair] = await Promise.all([this.getSettings(actor.tenantDb), this.pairContext(actor, targetId)]);
      if (!canStartDirect(settings.policy, pair)) throw new ForbiddenException('سیاست پیام‌رسان این محیط کاری اجازه‌ی شروع گفتگو با این کاربر را نمی‌دهد');
      try {
        conv = await actor.tenantDb.messengerConversation.create({
          data: {
            type: 'DIRECT',
            directKey: key,
            createdById: actor.userId,
            members: { create: [{ userId: actor.userId, role: 'MEMBER' }, { userId: targetId, role: 'MEMBER' }] },
          },
        });
      } catch {
        conv = await actor.tenantDb.messengerConversation.findUnique({ where: { directKey: key } });
        if (!conv) throw new ConflictException('ساخت گفتگو ناموفق بود');
      }
      this.gateway.emitToUsers(actor.tenantId, [actor.userId, targetId], 'conversation:updated', { conversationId: conv.id });
    }
    return this.getConversation(actor, conv.id);
  }

  async createGroup(actor: MessengerActor, title: string, memberIds: string[]) {
    const settings = await this.getSettings(actor.tenantDb);
    if (!canCreateGroup(settings.groupCreation, actor.isManager)) throw new ForbiddenException('در این محیط کاری فقط مدیران می‌توانند گروه بسازند');
    if (!this.groupLimiter.take(`${actor.tenantId}:${actor.userId}`)) throw new ForbiddenException('تعداد ساخت گروه در یک ساعت زیاد بود؛ کمی بعد دوباره تلاش کنید');
    const ids = [...new Set(memberIds)].filter((id) => id !== actor.userId);
    const users = await actor.tenantDb.user.findMany({ where: { id: { in: ids }, status: { not: 'DISABLED' } }, select: { id: true } });
    if (users.length === 0) throw new BadRequestException('حداقل یک عضو دیگر انتخاب کنید');
    const conv = await actor.tenantDb.messengerConversation.create({
      data: {
        type: 'GROUP',
        title: title.trim(),
        createdById: actor.userId,
        members: { create: [{ userId: actor.userId, role: 'OWNER' }, ...users.map((u) => ({ userId: u.id, role: 'MEMBER' as const }))] },
      },
    });
    await this.systemMessage(actor, conv.id, `${(await this.names(actor.tenantDb, [actor.userId])).get(actor.userId) ?? 'کاربر'} گروه را ساخت`);
    this.gateway.emitToUsers(actor.tenantId, [actor.userId, ...users.map((u) => u.id)], 'conversation:updated', { conversationId: conv.id });
    return this.getConversation(actor, conv.id);
  }

  async listConversations(actor: MessengerActor) {
    await this.ensureSaved(actor);
    const memberships = (await actor.tenantDb.messengerMember.findMany({
      where: { userId: actor.userId },
      include: { conversation: { include: { members: { select: { userId: true, lastReadSeq: true, lastDeliveredSeq: true } } } } },
    })) as unknown as (MemberRow & { conversation: ConversationRow & { members: { userId: string; lastReadSeq: number; lastDeliveredSeq: number }[] } })[];
    const peerIds = memberships.filter((m) => m.conversation.type === 'DIRECT').map((m) => m.conversation.members.find((x) => x.userId !== actor.userId)?.userId ?? '');
    const names = await this.names(actor.tenantDb, peerIds.filter(Boolean));
    const settings = await this.getSettings(actor.tenantDb);

    const items = await Promise.all(
      memberships.map(async (m) => {
        const visible = { conversationId: m.conversationId, seq: { gt: m.visibleFromSeq }, hides: { none: { userId: actor.userId } } };
        const [last, unread] = await Promise.all([
          actor.tenantDb.messengerMessage.findFirst({ where: visible, orderBy: { seq: 'desc' }, include: { media: true } }),
          actor.tenantDb.messengerMessage.count({
            where: { ...visible, seq: { gt: Math.max(m.lastReadSeq, m.visibleFromSeq) }, senderId: { not: actor.userId }, deletedForAllAt: null, kind: { not: 'SYSTEM' } },
          }),
        ]);
        const peerId = m.conversation.type === 'DIRECT' ? (m.conversation.members.find((x) => x.userId !== actor.userId)?.userId ?? null) : null;
        const lastDto = last ? (await this.toDtos(actor, [last as unknown as MessageRow]))[0] : null;
        const lastMessageStatus =
          last && last.senderId === actor.userId && last.kind !== 'SYSTEM' && !last.deletedForAllAt && m.conversation.type !== 'SAVED'
            ? deliveryStatus(last.seq, m.conversation.members.filter((x) => x.userId !== actor.userId))
            : null;
        return {
          id: m.conversationId,
          type: m.conversation.type,
          title: m.conversation.type === 'DIRECT' ? (peerId ? (names.get(peerId) ?? 'کاربر') : 'کاربر') : (m.conversation.title ?? 'گروه'),
          peerId,
          peerOnline: peerId ? this.presenceOf(actor.tenantId, peerId, settings).online : false,
          muted: m.muted,
          unread,
          memberCount: m.conversation.members.length,
          lastMessage: lastDto,
          lastMessageStatus,
          lastSeq: m.conversation.lastSeq,
          pinnedAt: m.pinnedAt?.toISOString() ?? null,
          archived: !!m.archivedAt,
          lastMessageAt: (last?.createdAt ?? m.conversation.createdAt).toISOString(),
        };
      }),
    );
    // سنجاق‌شده‌ها بالا، بقیه بر اساس آخرین فعالیت
    return sortConversationList(items);
  }

  async unreadTotal(actor: MessengerActor): Promise<{ total: number }> {
    const memberships = await actor.tenantDb.messengerMember.findMany({ where: { userId: actor.userId, muted: false } });
    const counts = await Promise.all(
      memberships.map((m) =>
        actor.tenantDb.messengerMessage.count({
          where: {
            conversationId: m.conversationId,
            seq: { gt: Math.max(m.lastReadSeq, m.visibleFromSeq) },
            senderId: { not: actor.userId },
            deletedForAllAt: null,
            kind: { not: 'SYSTEM' },
            hides: { none: { userId: actor.userId } },
          },
        }),
      ),
    );
    return { total: counts.reduce((a, b) => a + b, 0) };
  }

  async getConversation(actor: MessengerActor, id: string) {
    const { conversation, member } = await this.requireMember(actor, id);
    const [members, settings] = await Promise.all([actor.tenantDb.messengerMember.findMany({ where: { conversationId: id }, orderBy: { joinedAt: 'asc' } }), this.getSettings(actor.tenantDb)]);
    const ids = members.map((m) => m.userId);
    const [names, presence, pins] = await Promise.all([
      this.names(actor.tenantDb, ids),
      actor.tenantDb.messengerPresence.findMany({ where: { userId: { in: ids } } }),
      actor.tenantDb.messengerPin.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const presenceBy = new Map(presence.map((p) => [p.userId, p]));
    const pinned = pins.length
      ? await actor.tenantDb.messengerMessage.findMany({
          where: { id: { in: pins.map((p) => p.messageId) }, seq: { gt: member.visibleFromSeq }, deletedForAllAt: null },
          include: { media: true, reactions: true },
        })
      : [];
    const pinnedDtos = await this.toDtos(actor, pinned as unknown as MessageRow[]);
    const pinOrder = new Map(pins.map((p, i) => [p.messageId, i]));
    pinnedDtos.sort((a, b) => (pinOrder.get(a.id) ?? 0) - (pinOrder.get(b.id) ?? 0));
    const peer = conversation.type === 'DIRECT' ? members.find((m) => m.userId !== actor.userId) : undefined;
    return {
      id: conversation.id,
      type: conversation.type,
      title: conversation.type === 'DIRECT' ? (names.get(peer?.userId ?? '') ?? 'کاربر') : (conversation.title ?? 'گروه'),
      peerId: peer?.userId ?? null,
      myRole: member.role,
      muted: member.muted,
      lastReadSeq: member.lastReadSeq,
      lastSeq: conversation.lastSeq,
      members: members.map((m) => ({
        userId: m.userId,
        name: names.get(m.userId) ?? 'کاربر',
        role: m.role,
        lastReadSeq: m.lastReadSeq,
        lastDeliveredSeq: m.lastDeliveredSeq,
        ...this.presenceOf(actor.tenantId, m.userId, settings, presenceBy.get(m.userId)),
      })),
      pinned: pinnedDtos,
    };
  }

  async setMuted(actor: MessengerActor, id: string, muted: boolean) {
    await this.requireMember(actor, id);
    await actor.tenantDb.messengerMember.update({ where: { conversationId_userId: { conversationId: id, userId: actor.userId } }, data: { muted } });
    this.gateway.emitToUsers(actor.tenantId, [actor.userId], 'conversation:updated', { conversationId: id });
    return { muted };
  }

  async setChatPinned(actor: MessengerActor, id: string, pinned: boolean) {
    const { member } = await this.requireMember(actor, id);
    if (pinned && !member.pinnedAt) {
      const count = await actor.tenantDb.messengerMember.count({ where: { userId: actor.userId, pinnedAt: { not: null } } });
      if (count >= MAX_PINNED_CHATS) throw new BadRequestException(`حداکثر ${MAX_PINNED_CHATS} گفتگو را می‌توان سنجاق کرد`);
    }
    await actor.tenantDb.messengerMember.update({
      where: { conversationId_userId: { conversationId: id, userId: actor.userId } },
      data: pinned ? { pinnedAt: member.pinnedAt ?? new Date(), archivedAt: null } : { pinnedAt: null },
    });
    this.gateway.emitToUsers(actor.tenantId, [actor.userId], 'conversation:updated', { conversationId: id });
    return { pinned };
  }

  async setChatArchived(actor: MessengerActor, id: string, archived: boolean) {
    await this.requireMember(actor, id);
    await actor.tenantDb.messengerMember.update({
      where: { conversationId_userId: { conversationId: id, userId: actor.userId } },
      data: archived ? { archivedAt: new Date(), pinnedAt: null } : { archivedAt: null },
    });
    this.gateway.emitToUsers(actor.tenantId, [actor.userId], 'conversation:updated', { conversationId: id });
    return { archived };
  }

  // ── مدیریت گروه ────────────────────────────────────────────────────

  private async requireGroupAdmin(actor: MessengerActor, id: string) {
    const r = await this.requireMember(actor, id);
    if (r.conversation.type !== 'GROUP') throw new BadRequestException('این عملیات فقط برای گروه است');
    if (!canManageMembers(r.member.role)) throw new ForbiddenException('فقط مالک یا مدیر گروه این کار را می‌تواند انجام دهد');
    return r;
  }

  async renameGroup(actor: MessengerActor, id: string, title: string) {
    await this.requireGroupAdmin(actor, id);
    await actor.tenantDb.messengerConversation.update({ where: { id }, data: { title: title.trim() } });
    await this.systemMessage(actor, id, `نام گروه به «${title.trim()}» تغییر کرد`);
    this.notifyConversation(actor, id, await this.memberIds(actor.tenantDb, id));
    return this.getConversation(actor, id);
  }

  async addMembers(actor: MessengerActor, id: string, userIds: string[]) {
    const { conversation } = await this.requireGroupAdmin(actor, id);
    const existing = new Set(await this.memberIds(actor.tenantDb, id));
    const fresh = [...new Set(userIds)].filter((u) => !existing.has(u));
    const users = await actor.tenantDb.user.findMany({ where: { id: { in: fresh }, status: { not: 'DISABLED' } }, select: { id: true, name: true } });
    if (users.length === 0) throw new BadRequestException('کاربر معتبری برای افزودن انتخاب نشده است');
    await actor.tenantDb.messengerMember.createMany({
      data: users.map((u) => ({ conversationId: id, userId: u.id, role: 'MEMBER' as const, visibleFromSeq: conversation.lastSeq, lastReadSeq: conversation.lastSeq, lastDeliveredSeq: conversation.lastSeq })),
    });
    await this.systemMessage(actor, id, `${users.map((u) => u.name).join('، ')} به گروه اضافه ${users.length > 1 ? 'شدند' : 'شد'}`);
    this.notifyConversation(actor, id, await this.memberIds(actor.tenantDb, id));
    return this.getConversation(actor, id);
  }

  async removeMember(actor: MessengerActor, id: string, userId: string) {
    const { member } = await this.requireGroupAdmin(actor, id);
    if (userId === actor.userId) return this.leave(actor, id);
    const target = await actor.tenantDb.messengerMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId } } });
    if (!target) throw new NotFoundException('عضو یافت نشد');
    if (!canRemoveMember(member.role, target.role as MemberRole)) throw new ForbiddenException('اجازه‌ی حذف این عضو را ندارید');
    const before = await this.memberIds(actor.tenantDb, id);
    await actor.tenantDb.messengerMember.delete({ where: { conversationId_userId: { conversationId: id, userId } } });
    const name = (await this.names(actor.tenantDb, [userId])).get(userId) ?? 'کاربر';
    await this.systemMessage(actor, id, `${name} از گروه حذف شد`);
    this.notifyConversation(actor, id, before);
    return this.getConversation(actor, id);
  }

  async setRole(actor: MessengerActor, id: string, userId: string, role: 'ADMIN' | 'MEMBER') {
    const { member } = await this.requireGroupAdmin(actor, id);
    if (member.role !== 'OWNER') throw new ForbiddenException('فقط مالک گروه می‌تواند نقش اعضا را تغییر دهد');
    const target = await actor.tenantDb.messengerMember.findUnique({ where: { conversationId_userId: { conversationId: id, userId } } });
    if (!target || target.role === 'OWNER') throw new NotFoundException('عضو یافت نشد');
    await actor.tenantDb.messengerMember.update({ where: { conversationId_userId: { conversationId: id, userId } }, data: { role } });
    this.notifyConversation(actor, id, await this.memberIds(actor.tenantDb, id));
    return this.getConversation(actor, id);
  }

  async leave(actor: MessengerActor, id: string) {
    const { conversation, member } = await this.requireMember(actor, id);
    if (conversation.type !== 'GROUP') throw new BadRequestException('فقط از گروه می‌توان خارج شد');
    const members = await actor.tenantDb.messengerMember.findMany({ where: { conversationId: id } });
    const before = members.map((m) => m.userId);
    const others = members.filter((m) => m.userId !== actor.userId);
    if (others.length === 0) {
      await actor.tenantDb.messengerConversation.delete({ where: { id } });
      this.gateway.emitToUsers(actor.tenantId, before, 'conversation:updated', { conversationId: id });
      return { left: true };
    }
    if (member.role === 'OWNER') {
      const next = pickNextOwner(others.map((m) => ({ userId: m.userId, role: m.role as MemberRole, joinedAt: m.joinedAt })));
      if (next) await actor.tenantDb.messengerMember.update({ where: { conversationId_userId: { conversationId: id, userId: next } }, data: { role: 'OWNER' } });
    }
    await actor.tenantDb.messengerMember.delete({ where: { conversationId_userId: { conversationId: id, userId: actor.userId } } });
    const name = (await this.names(actor.tenantDb, [actor.userId])).get(actor.userId) ?? 'کاربر';
    await this.systemMessage({ ...actor }, id, `${name} گروه را ترک کرد`);
    this.notifyConversation(actor, id, before);
    return { left: true };
  }

  private notifyConversation(actor: MessengerActor, conversationId: string, userIds: string[]) {
    this.gateway.emitToUsers(actor.tenantId, userIds, 'conversation:updated', { conversationId });
  }

  // ── پیام‌ها ─────────────────────────────────────────────────────────

  /** افزایش اتمیک seq و ساخت پیام. */
  private async insertMessage(db: Db, conversationId: string, data: { senderId: string; kind: 'TEXT' | 'MEDIA' | 'SYSTEM'; text?: string | null; replyToId?: string | null; forwardedFromName?: string | null; forwardedFromUserId?: string | null; mediaId?: string | null; mentionIds?: string[]; clientId?: string | null }): Promise<MessageRow> {
    return (await db.$transaction(async (tx) => {
      const conv = await tx.messengerConversation.update({ where: { id: conversationId }, data: { lastSeq: { increment: 1 }, lastMessageAt: new Date() }, select: { lastSeq: true } });
      const msg = await tx.messengerMessage.create({
        data: { conversationId, seq: conv.lastSeq, senderId: data.senderId, kind: data.kind, text: data.text ?? null, replyToId: data.replyToId ?? null, forwardedFromName: data.forwardedFromName ?? null, forwardedFromUserId: data.forwardedFromUserId ?? null, mediaId: data.mediaId ?? null, mentionIds: data.mentionIds ?? [], clientId: data.clientId ?? null },
        include: { media: true, reactions: true },
      });
      if (data.kind !== 'SYSTEM') {
        await tx.messengerMember.update({ where: { conversationId_userId: { conversationId, userId: data.senderId } }, data: { lastReadSeq: conv.lastSeq, lastDeliveredSeq: conv.lastSeq } });
      }
      return msg;
    })) as unknown as MessageRow;
  }

  private async systemMessage(actor: MessengerActor, conversationId: string, text: string) {
    const msg = await this.insertMessage(actor.tenantDb, conversationId, { senderId: actor.userId, kind: 'SYSTEM', text });
    const dto = (await this.toDtos(actor, [msg]))[0];
    this.gateway.emitToUsers(actor.tenantId, await this.memberIds(actor.tenantDb, conversationId), 'message:new', { message: dto });
  }

  /** بررسی اینکه کاربر اجازه‌ی ارسال در این گفتگو را دارد (سیاست پیام مستقیم). */
  async assertCanSend(actor: MessengerActor, conversation: ConversationRow) {
    if (conversation.type !== 'DIRECT') return;
    const ids = await this.memberIds(actor.tenantDb, conversation.id);
    const peerId = ids.find((i) => i !== actor.userId);
    if (!peerId) throw new ForbiddenException('طرف مقابل در دسترس نیست');
    const [settings, pair] = await Promise.all([this.getSettings(actor.tenantDb), this.pairContext(actor, peerId)]);
    const ok = canSendDirect(settings.policy, { ...pair, createdByManager: pair.managers.has(conversation.createdById) });
    if (!ok) throw new ForbiddenException('سیاست پیام‌رسان این محیط کاری اجازه‌ی ارسال پیام به این کاربر را نمی‌دهد');
  }

  async sendMessage(actor: MessengerActor, conversationId: string, dto: { text?: string; replyToId?: string; mediaId?: string; mentionIds?: string[]; clientId?: string }) {
    if (!this.sendLimiter.take(`${actor.tenantId}:${actor.userId}`)) throw new ForbiddenException('ارسال پیام بیش از حد سریع است؛ کمی صبر کنید');
    const { conversation } = await this.requireMember(actor, conversationId);
    await this.assertCanSend(actor, conversation);
    if (dto.clientId) {
      // ارسال idempotent: تلاش دوباره‌ی صف آفلاین نباید پیام تکراری بسازد
      const dup = await actor.tenantDb.messengerMessage.findFirst({ where: { senderId: actor.userId, clientId: dto.clientId }, include: { media: true, reactions: true } });
      if (dup) return (await this.toDtos(actor, [dup as unknown as MessageRow]))[0];
    }
    const text = dto.text?.trim() ? dto.text.trim().slice(0, MAX_TEXT) : null;
    if (!text && !dto.mediaId) throw new BadRequestException('پیام خالی است');

    if (dto.replyToId) {
      const target = await actor.tenantDb.messengerMessage.findUnique({ where: { id: dto.replyToId }, select: { conversationId: true, deletedForAllAt: true } });
      if (!target || target.conversationId !== conversationId || target.deletedForAllAt) throw new BadRequestException('پیام مورد پاسخ در این گفتگو یافت نشد');
    }
    let kind: 'TEXT' | 'MEDIA' = 'TEXT';
    if (dto.mediaId) {
      const media = await actor.tenantDb.messengerMedia.findUnique({ where: { id: dto.mediaId }, include: { _count: { select: { messages: true } } } });
      if (!media || media.uploaderId !== actor.userId || media.conversationId !== conversationId) throw new BadRequestException('فایل یافت نشد');
      if (isMediaExpired(media)) throw new BadRequestException('فایل منقضی شده است');
      if (media._count.messages > 0) throw new BadRequestException('این فایل قبلاً ارسال شده است');
      kind = 'MEDIA';
    }
    let mentionIds: string[] = [];
    if (conversation.type === 'GROUP' && dto.mentionIds?.length) {
      const members = new Set(await this.memberIds(actor.tenantDb, conversationId));
      mentionIds = [...new Set(dto.mentionIds)].filter((m) => members.has(m) && m !== actor.userId);
    }
    const msg = await this.insertMessage(actor.tenantDb, conversationId, { senderId: actor.userId, kind, text, replyToId: dto.replyToId ?? null, mediaId: dto.mediaId ?? null, mentionIds, clientId: dto.clientId ?? null });
    return this.afterInsert(actor, conversation, msg);
  }

  private async afterInsert(actor: MessengerActor, conversation: ConversationRow, msg: MessageRow) {
    const dto = (await this.toDtos(actor, [msg]))[0];
    const members = await actor.tenantDb.messengerMember.findMany({ where: { conversationId: conversation.id } });
    this.gateway.emitToUsers(actor.tenantId, members.map((m) => m.userId), 'message:new', { message: dto });
    // پیام تازه گفتگوی بایگانی‌شده را (اگر بی‌صدا نیست) از بایگانی درمی‌آورد؛ مثل تلگرام
    const toUnarchive = members.filter((m) => m.userId !== actor.userId && m.archivedAt && !m.muted).map((m) => m.userId);
    if (toUnarchive.length) {
      void actor.tenantDb.messengerMember
        .updateMany({ where: { conversationId: conversation.id, userId: { in: toUnarchive } }, data: { archivedAt: null } })
        .then(() => this.gateway.emitToUsers(actor.tenantId, toUnarchive, 'conversation:updated', { conversationId: conversation.id }))
        .catch(() => undefined);
    }
    void this.pushToOffline(actor, conversation, members, msg, dto).catch((e) => this.logger.warn(`push failed: ${e instanceof Error ? e.message : e}`));
    return dto;
  }

  /** پوش برای اعضایی که الان تب فعال ندارند (احترام به بی‌صدا؛ منشن استثناست). یک تگ برای هر گفتگو = جایگزینی اعلان قبلی. */
  private async pushToOffline(actor: MessengerActor, conversation: ConversationRow, members: MemberRow[], msg: MessageRow, dto: MessageDto) {
    if (!this.push.isConfigured()) return;
    const settings = await this.getSettings(actor.tenantDb);
    const recipients = members.filter((m) => m.userId !== actor.userId && !this.gateway.isActive(actor.tenantId, m.userId) && (!m.muted || msg.mentionIds.includes(m.userId)));
    if (recipients.length === 0) return;
    await Promise.all(
      recipients.map((r) => {
        const { title, body } = buildPushText({
          conversationType: conversation.type,
          conversationTitle: conversation.title,
          senderName: dto.senderName,
          text: dto.text,
          media: dto.media,
          hidePreview: settings.hidePreview,
          mentioned: msg.mentionIds.includes(r.userId),
        });
        return this.push.allowsPush(actor.tenantDb, r.userId, 'messenger').then((ok) =>
          ok
            ? this.push.sendToTenantUser(
                actor.tenantDb,
                r.userId,
                {
                  title,
                  body,
                  url: `/messenger?c=${conversation.id}`,
                  tag: `messenger-${conversation.id}`,
                  icon: '/icons/icon-192.png',
                  actions: [{ action: 'reply', title: 'پاسخ سریع' }],
                  entityType: 'conversation',
                  entityId: conversation.id,
                },
                { category: 'messenger' },
              )
            : undefined,
        );
      }),
    );
  }

  async listMessages(actor: MessengerActor, conversationId: string, opts: { before?: number; after?: number; limit?: number }) {
    const { member } = await this.requireMember(actor, conversationId);
    const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
    if (opts.after !== undefined) {
      // همگام‌سازی پس از قطعی: پیام‌های جدیدتر از seq معلوم، از قدیم به جدید؛ hasMore یعنی شکاف بزرگ‌تر از سقف است
      const rows = await actor.tenantDb.messengerMessage.findMany({
        where: { conversationId, seq: { gt: Math.max(opts.after, member.visibleFromSeq) }, hides: { none: { userId: actor.userId } } },
        orderBy: { seq: 'asc' },
        take: limit + 1,
        include: { media: true, reactions: true },
      });
      return { messages: await this.toDtos(actor, rows.slice(0, limit) as unknown as MessageRow[]), hasMore: rows.length > limit };
    }
    const rows = await actor.tenantDb.messengerMessage.findMany({
      where: {
        conversationId,
        seq: { gt: member.visibleFromSeq, ...(opts.before ? { lt: opts.before } : {}) },
        hides: { none: { userId: actor.userId } },
      },
      orderBy: { seq: 'desc' },
      take: limit + 1,
      include: { media: true, reactions: true },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: await this.toDtos(actor, page as unknown as MessageRow[]), hasMore };
  }

  async markRead(actor: MessengerActor, conversationId: string, seq: number) {
    const { conversation, member } = await this.requireMember(actor, conversationId);
    const upTo = Math.min(seq, conversation.lastSeq);
    if (upTo <= member.lastReadSeq) return { lastReadSeq: member.lastReadSeq };
    await actor.tenantDb.messengerMember.update({
      where: { conversationId_userId: { conversationId, userId: actor.userId } },
      data: { lastReadSeq: upTo, lastDeliveredSeq: Math.max(member.lastDeliveredSeq, upTo) },
    });
    this.gateway.emitToUsers(actor.tenantId, await this.memberIds(actor.tenantDb, conversationId), 'receipt', {
      conversationId,
      userId: actor.userId,
      lastReadSeq: upTo,
      lastDeliveredSeq: Math.max(member.lastDeliveredSeq, upTo),
    });
    return { lastReadSeq: upTo };
  }

  private async loadVisibleMessage(actor: MessengerActor, messageId: string) {
    const msg = await actor.tenantDb.messengerMessage.findUnique({ where: { id: messageId }, include: { media: true, reactions: true } });
    if (!msg) throw new NotFoundException('پیام یافت نشد');
    const { conversation, member } = await this.requireMember(actor, msg.conversationId); // غیرعضو: ۴۰۴
    if (msg.seq <= member.visibleFromSeq) throw new NotFoundException('پیام یافت نشد');
    return { msg: msg as unknown as MessageRow, conversation, member };
  }

  async editMessage(actor: MessengerActor, messageId: string, text: string) {
    const { msg, conversation } = await this.loadVisibleMessage(actor, messageId);
    if (msg.senderId !== actor.userId) throw new ForbiddenException('فقط پیام خودتان را می‌توانید ویرایش کنید');
    if (msg.kind === 'SYSTEM' || msg.deletedForAllAt) throw new BadRequestException('این پیام قابل ویرایش نیست');
    if (msg.forwardedFromName) throw new BadRequestException('پیام فوروارد‌شده قابل ویرایش نیست');
    const clean = text.trim();
    if (!clean) throw new BadRequestException('متن پیام خالی است');
    const updated = await actor.tenantDb.messengerMessage.update({ where: { id: messageId }, data: { text: clean.slice(0, MAX_TEXT), editedAt: new Date() }, include: { media: true, reactions: true } });
    return this.broadcastUpdated(actor, conversation.id, updated as unknown as MessageRow);
  }

  async deleteMessage(actor: MessengerActor, messageId: string, scope: 'me' | 'all') {
    const { msg, conversation, member } = await this.loadVisibleMessage(actor, messageId);
    if (scope === 'me') {
      await actor.tenantDb.messengerMessageHide.upsert({ where: { messageId_userId: { messageId, userId: actor.userId } }, create: { messageId, userId: actor.userId }, update: {} });
      this.gateway.emitToUsers(actor.tenantId, [actor.userId], 'message:hidden', { conversationId: conversation.id, messageId });
      return { deleted: 'me' as const };
    }
    if (msg.kind === 'SYSTEM') throw new BadRequestException('پیام سیستمی حذف نمی‌شود');
    if (!canDeleteForAll({ isSender: msg.senderId === actor.userId, conversationType: conversation.type, role: member.role })) {
      throw new ForbiddenException('اجازه‌ی حذف این پیام برای همه را ندارید');
    }
    const mediaId = msg.mediaId;
    const updated = await actor.tenantDb.messengerMessage.update({ where: { id: messageId }, data: { deletedForAllAt: new Date(), text: null, mediaId: null, mentionIds: [] }, include: { media: true, reactions: true } });
    await actor.tenantDb.messengerPin.deleteMany({ where: { messageId } });
    await actor.tenantDb.messengerReaction.deleteMany({ where: { messageId } });
    if (mediaId) {
      // اگر هیچ پیام دیگری (مثلاً فوروارد) به این رسانه ارجاع ندارد، بایت‌ها همین حالا حذف می‌شوند
      const still = await actor.tenantDb.messengerMessage.count({ where: { mediaId } });
      if (still === 0) {
        await actor.tenantDb.messengerMediaBlob.deleteMany({ where: { mediaId } });
        await actor.tenantDb.messengerMedia.updateMany({ where: { id: mediaId, purgedAt: null }, data: { purgedAt: new Date() } });
      }
    }
    await this.broadcastUpdated(actor, conversation.id, { ...(updated as unknown as MessageRow), reactions: [] });
    return { deleted: 'all' as const };
  }

  private async broadcastUpdated(actor: MessengerActor, conversationId: string, msg: MessageRow) {
    const dto = (await this.toDtos(actor, [msg]))[0];
    this.gateway.emitToUsers(actor.tenantId, await this.memberIds(actor.tenantDb, conversationId), 'message:updated', { message: dto });
    return dto;
  }

  async react(actor: MessengerActor, messageId: string, emoji: string) {
    if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) throw new BadRequestException('این ایموجی مجاز نیست');
    const { msg, conversation } = await this.loadVisibleMessage(actor, messageId);
    if (msg.deletedForAllAt || msg.kind === 'SYSTEM') throw new BadRequestException('روی این پیام نمی‌توان واکنش گذاشت');
    const mine = await actor.tenantDb.messengerReaction.findFirst({ where: { messageId, userId: actor.userId } });
    const { remove, add } = nextReactionState(mine?.emoji ?? null, emoji);
    if (remove) await actor.tenantDb.messengerReaction.deleteMany({ where: { messageId, userId: actor.userId } });
    if (add) await actor.tenantDb.messengerReaction.create({ data: { messageId, userId: actor.userId, emoji: add } });
    const reactions = await actor.tenantDb.messengerReaction.findMany({ where: { messageId } });
    const grouped = this.groupReactions(reactions);
    this.gateway.emitToUsers(actor.tenantId, await this.memberIds(actor.tenantDb, conversation.id), 'reaction:updated', { conversationId: conversation.id, messageId, reactions: grouped });
    return { reactions: grouped };
  }

  private groupReactions(rows: { userId: string; emoji: string }[]) {
    const map = new Map<string, string[]>();
    for (const r of rows) map.set(r.emoji, [...(map.get(r.emoji) ?? []), r.userId]);
    return [...map.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
  }

  // ── فوروارد / ذخیره ────────────────────────────────────────────────

  async forward(actor: MessengerActor, messageId: string, conversationIds: string[]) {
    const { msg } = await this.loadVisibleMessage(actor, messageId);
    if (msg.deletedForAllAt || msg.kind === 'SYSTEM') throw new BadRequestException('این پیام قابل فوروارد نیست');
    if (msg.media && isMediaExpired(msg.media)) {
      if (!msg.text) throw new BadRequestException('فایل منقضی شده و قابل فوروارد نیست');
    }
    const mediaOk = msg.media && !isMediaExpired(msg.media);
    const names = await this.names(actor.tenantDb, [msg.senderId]);
    const originalName = msg.forwardedFromName ?? names.get(msg.senderId) ?? 'کاربر';
    const originalUser = msg.forwardedFromUserId ?? msg.senderId;
    const out: MessageDto[] = [];
    for (const convId of new Set(conversationIds)) {
      if (!this.sendLimiter.take(`${actor.tenantId}:${actor.userId}`)) throw new ForbiddenException('ارسال پیام بیش از حد سریع است؛ کمی صبر کنید');
      const { conversation } = await this.requireMember(actor, convId);
      await this.assertCanSend(actor, conversation);
      const created = await this.insertMessage(actor.tenantDb, convId, {
        senderId: actor.userId,
        kind: mediaOk ? 'MEDIA' : 'TEXT',
        text: msg.text,
        forwardedFromName: originalName,
        forwardedFromUserId: originalUser,
        mediaId: mediaOk ? msg.mediaId : null,
      });
      out.push(await this.afterInsert(actor, conversation, created));
    }
    return { forwarded: out.length, messages: out };
  }

  /** «ذخیره»: کپی (فوروارد) پیام در گفتگوی شخصی ذخیره‌شده‌ها. */
  async save(actor: MessengerActor, messageId: string) {
    const saved = await this.ensureSaved(actor);
    const r = await this.forward(actor, messageId, [saved.id]);
    return { conversationId: saved.id, message: r.messages[0] };
  }

  // ── پین ─────────────────────────────────────────────────────────────

  async pin(actor: MessengerActor, conversationId: string, messageId: string, pinned: boolean) {
    const { conversation, member } = await this.requireMember(actor, conversationId);
    if (conversation.type === 'GROUP' && !canManageMembers(member.role)) throw new ForbiddenException('فقط مالک یا مدیر گروه می‌تواند پیام را سنجاق کند');
    const msg = await actor.tenantDb.messengerMessage.findUnique({ where: { id: messageId }, select: { conversationId: true, deletedForAllAt: true, seq: true } });
    if (!msg || msg.conversationId !== conversationId || msg.deletedForAllAt || msg.seq <= member.visibleFromSeq) throw new NotFoundException('پیام یافت نشد');
    if (pinned) {
      await actor.tenantDb.messengerPin.upsert({ where: { conversationId_messageId: { conversationId, messageId } }, create: { conversationId, messageId, pinnedById: actor.userId }, update: {} });
    } else {
      await actor.tenantDb.messengerPin.deleteMany({ where: { conversationId, messageId } });
    }
    this.notifyConversation(actor, conversationId, await this.memberIds(actor.tenantDb, conversationId));
    return this.getConversation(actor, conversationId);
  }

  // ── جست‌وجو ─────────────────────────────────────────────────────────

  async search(actor: MessengerActor, q: string, conversationId?: string) {
    const term = q.trim();
    if (term.length < 2) throw new BadRequestException('حداقل ۲ نویسه برای جست‌وجو وارد کنید');
    const memberships = await actor.tenantDb.messengerMember.findMany({ where: { userId: actor.userId, ...(conversationId ? { conversationId } : {}) } });
    if (conversationId && memberships.length === 0) throw new NotFoundException(NOT_FOUND);
    const results: MessageRow[] = [];
    const rows = await Promise.all(
      memberships.map((m) =>
        actor.tenantDb.messengerMessage.findMany({
          where: { conversationId: m.conversationId, seq: { gt: m.visibleFromSeq }, deletedForAllAt: null, kind: { not: 'SYSTEM' }, text: { contains: term, mode: 'insensitive' }, hides: { none: { userId: actor.userId } } },
          orderBy: { seq: 'desc' },
          take: 20,
          include: { media: true, reactions: true },
        }),
      ),
    );
    for (const r of rows) results.push(...(r as unknown as MessageRow[]));
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const top = results.slice(0, 40);
    const convs = await actor.tenantDb.messengerConversation.findMany({ where: { id: { in: [...new Set(top.map((m) => m.conversationId))] } }, include: { members: { select: { userId: true } } } });
    const peerNames = await this.names(actor.tenantDb, convs.flatMap((c) => c.members.map((m) => m.userId)));
    const titleOf = new Map(convs.map((c) => [c.id, c.type === 'DIRECT' ? (peerNames.get(c.members.find((m) => m.userId !== actor.userId)?.userId ?? '') ?? 'کاربر') : (c.title ?? 'گروه')]));
    const dtos = await this.toDtos(actor, top);
    return dtos.map((d) => ({ ...d, conversationTitle: titleOf.get(d.conversationId) ?? '' }));
  }

  // ── DTO ─────────────────────────────────────────────────────────────

  async toDtos(actor: MessengerActor, rows: MessageRow[]): Promise<MessageDto[]> {
    if (rows.length === 0) return [];
    const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
    const replies = replyIds.length
      ? await actor.tenantDb.messengerMessage.findMany({ where: { id: { in: replyIds } }, select: { id: true, senderId: true, text: true, mediaId: true, deletedForAllAt: true, media: { select: { fileName: true } } } })
      : [];
    const replyBy = new Map(replies.map((r) => [r.id, r]));
    const names = await this.names(actor.tenantDb, [...rows.map((r) => r.senderId), ...replies.map((r) => r.senderId)]);
    const now = new Date();
    return rows.map((r) => {
      const deleted = r.deletedForAllAt !== null;
      const reply = r.replyToId ? replyBy.get(r.replyToId) : undefined;
      return {
        id: r.id,
        conversationId: r.conversationId,
        seq: r.seq,
        senderId: r.senderId,
        senderName: names.get(r.senderId) ?? 'کاربر',
        kind: r.kind,
        text: deleted ? null : r.text,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt?.toISOString() ?? null,
        deleted,
        replyTo: reply
          ? { id: reply.id, senderName: names.get(reply.senderId) ?? 'کاربر', text: reply.deletedForAllAt ? '' : snippet(reply.text || reply.media?.fileName, 80), hasMedia: !!reply.mediaId, deleted: reply.deletedForAllAt !== null }
          : null,
        forwardedFrom: r.forwardedFromName,
        media:
          r.media && !deleted
            ? { id: r.media.id, kind: r.media.kind, mime: r.media.mime, fileName: r.media.fileName, size: r.media.size, expiresAt: r.media.expiresAt.toISOString(), expired: isMediaExpired(r.media, now), hoursLeft: hoursUntilExpiry(r.media, now) }
            : null,
        reactions: deleted ? [] : this.groupReactions(r.reactions ?? []),
        mentionIds: r.mentionIds ?? [],
        clientId: r.clientId ?? null,
      };
    });
  }
}
