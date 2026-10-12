import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { SessionVerifierService } from '../security/session-verifier.service.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { SlidingWindowLimiter } from './messenger-policy.js';

type SocketInfo = { tenantId: string; userId: string; tenantDb: TenantPrismaClient; visible: boolean; hidden: boolean };

/**
 * ترنسپورت زنده‌ی پیام‌رسان داخلی (namespace جدا از `/support` که مخصوص پشتیبانی پلتفرم است).
 * احراز هویت یک‌بار هنگام اتصال: همان JWT تننت + اعتبارسنجی نشست/عضویت (SessionVerifierService) و فعال‌بودن ماژول؛
 * سپس سوکت فقط به اتاق شخصی خودش در همان تننت (`t:<tenant>:u:<user>`) و اتاق حضور تننت (`t:<tenant>`) می‌پیوندد.
 * اتاق‌ها هرگز بین تننت‌ها مشترک نیستند و رویدادها فقط به اعضای واقعی گفتگو (از دیتابیس) فرستاده می‌شوند —
 * پس عضویت در لحظه‌ی ارسال سنجیده می‌شود، نه با اتاق‌های گفتگوی ماندگار که پس از حذف عضو باید دستی خالی شوند.
 */
@WebSocketGateway({
  namespace: '/messenger',
  cors: {
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3002').split(','),
    credentials: true,
  },
})
export class MessengerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(MessengerGateway.name);
  private readonly bySocket = new Map<string, SocketInfo>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly typingLimiter = new SlidingWindowLimiter(3, 2000);

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sessions: SessionVerifierService,
  ) {}

  private key(tenantId: string, userId: string) {
    return `${tenantId}:${userId}`;
  }
  private room(tenantId: string, userId: string) {
    return `t:${tenantId}:u:${userId}`;
  }

  async handleConnection(socket: Socket) {
    const token = (socket.handshake.auth?.token as string | undefined) ?? undefined;
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const { payload } = await this.sessions.verifyTenantToken(token);
      const tenant = await this.controlDb.tenant.findUnique({ where: { id: payload.tenantId } });
      if (!tenant) throw new Error('محیط کاری یافت نشد');
      const installed = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'messenger' } },
        select: { id: true },
      });
      if (!installed) throw new Error('ماژول پیام‌رسان فعال نیست');
      const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
      const user = await tenantDb.user.findUnique({ where: { globalUserId: payload.sub }, select: { id: true, status: true } });
      if (!user || user.status === 'DISABLED') throw new Error('کاربر یافت نشد');

      const presence = await tenantDb.messengerPresence.findUnique({ where: { userId: user.id } });
      const info: SocketInfo = { tenantId: tenant.id, userId: user.id, tenantDb, visible: true, hidden: presence?.hidden ?? false };
      this.bySocket.set(socket.id, info);
      const k = this.key(tenant.id, user.id);
      const set = this.byUser.get(k) ?? new Set<string>();
      const wasOffline = set.size === 0;
      set.add(socket.id);
      this.byUser.set(k, set);

      await socket.join(this.room(tenant.id, user.id));
      await socket.join(`t:${tenant.id}`);
      if (wasOffline && !info.hidden) this.server.to(`t:${tenant.id}`).emit('presence', { userId: user.id, online: true });
      void this.markDelivered(info).catch((e) => this.logger.warn(`delivered failed: ${e instanceof Error ? e.message : e}`));
    } catch (err) {
      this.logger.warn(`اتصال پیام‌رسان رد شد: ${(err as Error).message}`);
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    const info = this.bySocket.get(socket.id);
    this.bySocket.delete(socket.id);
    if (!info) return;
    const k = this.key(info.tenantId, info.userId);
    const set = this.byUser.get(k);
    set?.delete(socket.id);
    if (set && set.size === 0) {
      this.byUser.delete(k);
      const now = new Date();
      await info.tenantDb.messengerPresence
        .upsert({ where: { userId: info.userId }, create: { userId: info.userId, lastSeenAt: now }, update: { lastSeenAt: now } })
        .catch(() => undefined);
      if (!info.hidden) this.server.to(`t:${info.tenantId}`).emit('presence', { userId: info.userId, online: false, lastSeenAt: now.toISOString() });
    }
  }

  @SubscribeMessage('visibility')
  onVisibility(@ConnectedSocket() socket: Socket, @MessageBody() body: { visible?: boolean }) {
    const info = this.bySocket.get(socket.id);
    if (info) info.visible = body?.visible !== false;
  }

  @SubscribeMessage('typing')
  async onTyping(@ConnectedSocket() socket: Socket, @MessageBody() body: { conversationId?: string }) {
    const info = this.bySocket.get(socket.id);
    if (!info || typeof body?.conversationId !== 'string') return;
    if (!this.typingLimiter.take(`${socket.id}:${body.conversationId}`)) return;
    const members = await info.tenantDb.messengerMember.findMany({ where: { conversationId: body.conversationId }, select: { userId: true } });
    if (!members.some((m) => m.userId === info.userId)) return; // عضو نیست → بی‌صدا نادیده (۴۰۴ معنایی)
    this.emitToUsers(info.tenantId, members.map((m) => m.userId).filter((u) => u !== info.userId), 'typing', {
      conversationId: body.conversationId,
      userId: info.userId,
    });
  }

  @SubscribeMessage('delivered')
  async onDelivered(@ConnectedSocket() socket: Socket) {
    const info = this.bySocket.get(socket.id);
    if (info) await this.markDelivered(info);
  }

  /** همه‌ی گفتگوهای کاربر را «تحویل‌شده» علامت می‌زند و به طرف‌های مقابل خبر می‌دهد. */
  private async markDelivered(info: SocketInfo) {
    const rows = await info.tenantDb.$queryRaw<{ conversationId: string; lastDeliveredSeq: number }[]>`
      UPDATE "messenger_members" m SET "lastDeliveredSeq" = c."lastSeq"
      FROM "messenger_conversations" c
      WHERE m."conversationId" = c."id" AND m."userId" = ${info.userId} AND m."lastDeliveredSeq" < c."lastSeq"
      RETURNING m."conversationId" AS "conversationId", m."lastDeliveredSeq" AS "lastDeliveredSeq"`;
    for (const r of rows) {
      const members = await info.tenantDb.messengerMember.findMany({ where: { conversationId: r.conversationId }, select: { userId: true } });
      this.emitToUsers(info.tenantId, members.map((m) => m.userId), 'receipt', {
        conversationId: r.conversationId,
        userId: info.userId,
        lastDeliveredSeq: r.lastDeliveredSeq,
      });
    }
  }

  // ── API برای سرویس ────────────────────────────────────────────────────

  emitToUsers(tenantId: string, userIds: string[], event: string, payload: unknown) {
    if (!this.server || userIds.length === 0) return;
    const rooms = [...new Set(userIds)].map((u) => this.room(tenantId, u));
    this.server.to(rooms).emit(event, payload);
  }

  isOnline(tenantId: string, userId: string): boolean {
    return (this.byUser.get(this.key(tenantId, userId))?.size ?? 0) > 0;
  }

  /** کاربر الان تب بازِ قابل‌مشاهده دارد (پوش لازم نیست). */
  isActive(tenantId: string, userId: string): boolean {
    const ids = this.byUser.get(this.key(tenantId, userId));
    if (!ids) return false;
    for (const id of ids) if (this.bySocket.get(id)?.visible) return true;
    return false;
  }

  setHidden(tenantId: string, userId: string, hidden: boolean) {
    for (const id of this.byUser.get(this.key(tenantId, userId)) ?? []) {
      const info = this.bySocket.get(id);
      if (info) info.hidden = hidden;
    }
    if (this.isOnline(tenantId, userId) && this.server) {
      this.server.to(`t:${tenantId}`).emit('presence', hidden ? { userId, online: false, lastSeenAt: null } : { userId, online: true });
    }
  }
}
