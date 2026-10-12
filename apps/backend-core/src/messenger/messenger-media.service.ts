import { BadRequestException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { MessengerService, type MessengerActor } from './messenger.service.js';
import { SlidingWindowLimiter } from './messenger-policy.js';
import { MEDIA_DAILY_QUOTA, MEDIA_TTL_MS, hoursUntilExpiry, isMediaExpired, kindForMime, limitFor, magicMatches, normalizeMime, sanitizeFileName } from './messenger-media.util.js';
import { getSettingsRetention, purgeExpiredMedia, purgeOldText } from './messenger-purge.js';

const KIND_LABEL = { IMAGE: 'تصویر', FILE: 'فایل', VIDEO: 'ویدئو' } as const;

@Injectable()
export class MessengerMediaService {
  private readonly logger = new Logger('MessengerMediaService');
  private readonly uploadLimiter = new SlidingWindowLimiter(20, 60_000);

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly messenger: MessengerService,
  ) {}

  async upload(actor: MessengerActor, conversationId: string, body: Buffer, mimeHeader: string | undefined, nameHeader: string | undefined) {
    if (!this.uploadLimiter.take(`${actor.tenantId}:${actor.userId}`)) throw new ForbiddenException('ارسال فایل بیش از حد سریع است؛ کمی صبر کنید');
    const { conversation } = await this.messenger.requireMember(actor, conversationId);
    await this.messenger.assertCanSend(actor, conversation);

    const mime = normalizeMime(mimeHeader);
    const kind = kindForMime(mime);
    if (!kind) throw new UnsupportedMediaTypeException('این نوع فایل مجاز نیست (تصویر، ویدئو، PDF، اسناد آفیس، متن و فایل فشرده)');
    if (body.length === 0) throw new BadRequestException('فایل خالی است');
    const maxBytes = limitFor(kind, mime);
    if (body.length > maxBytes) {
      throw new PayloadTooLargeException(`حجم ${mime.startsWith('audio/') ? 'پیام صوتی' : KIND_LABEL[kind]} نباید بیشتر از ${Math.round(maxBytes / 1024 / 1024)} مگابایت باشد`);
    }
    if (!magicMatches(mime, body.subarray(0, 16))) throw new UnsupportedMediaTypeException('محتوای فایل با نوع اعلام‌شده نمی‌خواند');

    const since = new Date(Date.now() - MEDIA_TTL_MS);
    const used = await actor.tenantDb.messengerMedia.aggregate({ where: { uploaderId: actor.userId, createdAt: { gte: since } }, _count: { _all: true }, _sum: { size: true } });
    if ((used._count._all ?? 0) >= MEDIA_DAILY_QUOTA.count || (used._sum.size ?? 0) + body.length > MEDIA_DAILY_QUOTA.bytes) {
      throw new ForbiddenException('سهمیه‌ی ارسال فایل شما در ۲۴ ساعت گذشته تمام شده است؛ بعداً دوباره تلاش کنید');
    }

    const fallback = kind === 'IMAGE' ? 'image' : kind === 'VIDEO' ? 'video' : mime.startsWith('audio/') ? 'voice' : 'file';
    let decoded = nameHeader ?? '';
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      /* نام خراب → fallback */
    }
    const fileName = sanitizeFileName(decoded, fallback);
    const media = await actor.tenantDb.messengerMedia.create({
      data: { conversationId, uploaderId: actor.userId, kind, mime, fileName, size: body.length, expiresAt: new Date(Date.now() + MEDIA_TTL_MS), blob: { create: { data: new Uint8Array(body) } } },
    });
    return { id: media.id, kind, mime, fileName, size: media.size, expiresAt: media.expiresAt.toISOString(), hoursLeft: hoursUntilExpiry(media) };
  }

  /** دانلود: فقط عضو گفتگویی که پیامِ دارای این رسانه در آن هست (یا بارگذارنده‌ی هنوز‌ارسال‌نشده). */
  async download(actor: MessengerActor, mediaId: string) {
    const media = await actor.tenantDb.messengerMedia.findUnique({ where: { id: mediaId }, include: { blob: true } });
    if (!media) throw new NotFoundException('فایل یافت نشد');
    let allowed = media.uploaderId === actor.userId && (await actor.tenantDb.messengerMember.count({ where: { conversationId: media.conversationId, userId: actor.userId } })) > 0;
    if (!allowed) {
      const msgs = await actor.tenantDb.messengerMessage.findMany({
        where: { mediaId, deletedForAllAt: null, hides: { none: { userId: actor.userId } }, conversation: { members: { some: { userId: actor.userId } } } },
        select: { seq: true, conversationId: true },
        take: 20,
      });
      if (msgs.length) {
        const members = await actor.tenantDb.messengerMember.findMany({ where: { userId: actor.userId, conversationId: { in: msgs.map((m) => m.conversationId) } } });
        const vis = new Map(members.map((m) => [m.conversationId, m.visibleFromSeq]));
        allowed = msgs.some((m) => m.seq > (vis.get(m.conversationId) ?? 0));
      }
    }
    if (!allowed) throw new NotFoundException('فایل یافت نشد'); // وجود فایل برای غیرعضو فاش نمی‌شود
    if (isMediaExpired(media) || !media.blob) throw new GoneException('فایل منقضی شد');
    return { data: Buffer.from(media.blob.data), mime: media.mime, fileName: media.fileName, kind: media.kind };
  }

  // ── پاکسازی ساعتی در همه‌ی تننت‌ها ─────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      // حتی اگر ماژول بعداً خاموش شده، رسانه‌های باقی‌مانده باید پاک شوند؛ پس فقط وجودِ هر رکورد نصبِ ماژول کافی است
      const installed = await this.controlDb.tenantModule.findFirst({ where: { tenantId: tenant.id, module: { code: 'messenger' } }, select: { id: true } });
      if (!installed) continue;
      try {
        const db = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        await this.sweepTenant(db);
      } catch (err) {
        this.logger.error(`Messenger purge failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async sweepTenant(db: TenantPrismaClient, now = new Date()): Promise<{ media: number; messages: number }> {
    const media = await purgeExpiredMedia(db, now);
    const days = await getSettingsRetention(db);
    const messages = days ? await purgeOldText(db, days, now) : 0;
    return { media, messages };
  }
}
