import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpException, NotFoundException, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { MarkDeliveredDto, PushTestDto, RenameDeviceDto, SubscribePushDto } from './dto/subscribe-push.dto.js';
import { UpdateNotificationPreferenceDto } from './dto/update-notification-preference.dto.js';
import { PushNotificationsService, vapidKeyHash } from './push-notifications.service.js';
import { NotificationDeliveryService } from './notification-delivery.service.js';
import { FAILURE_REASON_FA, REMINDER_DEFAULT_HOURS, clampReminderHours, SlidingRateLimiter, deviceLabelFromUserAgent, isAllowedPushEndpoint, parseHHmm, sanitizeCategoryPrefs } from './push-logic.js';

// سقف نرخ به‌ازای کاربر: آزمایش پوش ۵/دقیقه، ثبت اشتراک ۲۰/دقیقه (جلوگیری از اسکن/سوءاستفاده)
const testLimiter = new SlidingRateLimiter(5, 60_000);
const subscribeLimiter = new SlidingRateLimiter(20, 60_000);
/** «/tasks?id=1» → «/tasks» (فقط مسیر درون‌برنامه). */
function firstPathSegment(link: string | null): string | null {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return null;
  const m = /^\/[^/?#]+/.exec(link);
  return m ? m[0] : null;
}

function limit(l: SlidingRateLimiter, key: string) {
  if (!l.allow(key)) throw new HttpException('تعداد درخواست بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید', 429);
}

const PREF_DEFAULTS = {
  emailEnabled: true,
  smsEnabled: false,
  soundEnabled: true,
  categoryPrefs: {},
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '07:00',
  smsFallbackEnabled: false,
  toastEnabled: true,
  reminderEnabled: true,
  reminderAfterHours: REMINDER_DEFAULT_HOURS,
};

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly push: PushNotificationsService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  /**
   * فهرست اعلان‌ها. پیش‌فرض ۳۰ مورد آخر (سازگار با زنگوله‌ی قبلی)؛ برای صفحه‌ی اعلان‌ها:
   * ?limit=(حداکثر ۱۰۰) &unread=1 &important=1 &before=<ISO> (صفحه‌بندی با createdAt).
   * unreadCount/importantUnread همیشه کل واقعی کاربرند، نه تعداد صفحه.
   */
  @Get()
  async list(@Ctx() ctx: TenantRequestContext, @Query('limit') limitQ?: string, @Query('unread') unreadQ?: string, @Query('important') importantQ?: string, @Query('before') beforeQ?: string) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { unreadCount: 0, importantUnread: 0, items: [], hasMore: false };
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitQ ?? '30', 10) || 30));
    const before = beforeQ ? new Date(beforeQ) : null;
    const where = {
      userId,
      ...(unreadQ === '1' ? { readAt: null } : {}),
      ...(importantQ === '1' ? { important: true } : {}),
      ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
    };
    const [rows, unreadCount, importantUnread] = await Promise.all([
      ctx.tenantDb.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit + 1 }),
      ctx.tenantDb.notification.count({ where: { userId, readAt: null } }),
      ctx.tenantDb.notification.count({ where: { userId, readAt: null, important: true } }),
    ]);
    return { unreadCount, importantUnread, items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  /**
   * «نیاز به توجه شما»: اعلان‌های مهمِ نخوانده (حداکثر ۲۰) + شمارش نخوانده‌ها به تفکیک دسته و به تفکیک اولین بخش لینک
   * (برای نشان تعداد روی آیتم‌های منو، مثل /tasks یا /approvals).
   */
  @Get('attention')
  async attention(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { items: [], total: 0, importantTotal: 0, byCategory: {}, byLink: {} };
    const [items, importantTotal, unread] = await Promise.all([
      ctx.tenantDb.notification.findMany({ where: { userId, readAt: null, important: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      ctx.tenantDb.notification.count({ where: { userId, readAt: null, important: true } }),
      ctx.tenantDb.notification.findMany({ where: { userId, readAt: null }, select: { category: true, link: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
    ]);
    const byCategory: Record<string, number> = {};
    const byLink: Record<string, number> = {};
    for (const n of unread) {
      byCategory[n.category ?? 'system'] = (byCategory[n.category ?? 'system'] ?? 0) + 1;
      const seg = firstPathSegment(n.link);
      if (seg) byLink[seg] = (byLink[seg] ?? 0) + 1;
    }
    return { items, total: unread.length, importantTotal, byCategory, byLink };
  }

  /** زنگوله/صندوق اعلان وقتی اعلان‌ها را نشان می‌دهد صدا می‌زند (دسته‌ای) — «تحویل درون‌برنامه». */
  @Post('delivered')
  async markDelivered(@Body() dto: MarkDeliveredDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { delivered: 0 };
    return { delivered: await this.delivery.markDelivered(ctx.tenantDb, userId, dto.ids ?? [], 'in-app', ctx.tenantId) };
  }

  @Post(':id/read')
  async markRead(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) throw new ForbiddenException('این عملیات برای کلید API مجاز نیست');
    // خواندن = قطعاً دریافت (مثلاً کاربر از لینک پوش وارد شد)
    void this.delivery.markDelivered(ctx.tenantDb, userId, [id], 'in-app', ctx.tenantId);
    return ctx.tenantDb.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }

  @Post('read-all')
  async markAllRead(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { count: 0 };
    return ctx.tenantDb.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  @Get('preferences')
  async getPreferences(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return PREF_DEFAULTS;
    const pref = await ctx.tenantDb.notificationPreference.findUnique({ where: { userId } });
    return this.prefView(pref);
  }

  @Put('preferences')
  async updatePreferences(@Body() dto: UpdateNotificationPreferenceDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return PREF_DEFAULTS;
    const quietStart = dto.quietStart && parseHHmm(dto.quietStart) !== null ? dto.quietStart : undefined;
    const quietEnd = dto.quietEnd && parseHHmm(dto.quietEnd) !== null ? dto.quietEnd : undefined;
    const categoryPrefs = dto.categoryPrefs ? sanitizeCategoryPrefs(dto.categoryPrefs) : undefined;
    const patch = {
      emailEnabled: dto.emailEnabled,
      smsEnabled: dto.smsEnabled,
      soundEnabled: dto.soundEnabled,
      categoryPrefs,
      quietHoursEnabled: dto.quietHoursEnabled,
      quietStart,
      quietEnd,
      smsFallbackEnabled: dto.smsFallbackEnabled,
      toastEnabled: dto.toastEnabled,
      reminderEnabled: dto.reminderEnabled,
      reminderAfterHours: dto.reminderAfterHours === undefined ? undefined : clampReminderHours(dto.reminderAfterHours),
    };
    const saved = await ctx.tenantDb.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        emailEnabled: dto.emailEnabled ?? true,
        smsEnabled: dto.smsEnabled ?? false,
        soundEnabled: dto.soundEnabled ?? true,
        categoryPrefs: categoryPrefs ?? {},
        quietHoursEnabled: dto.quietHoursEnabled ?? false,
        quietStart: quietStart ?? '22:00',
        quietEnd: quietEnd ?? '07:00',
        smsFallbackEnabled: dto.smsFallbackEnabled ?? false,
        toastEnabled: dto.toastEnabled ?? true,
        reminderEnabled: dto.reminderEnabled ?? true,
        reminderAfterHours: clampReminderHours(dto.reminderAfterHours ?? REMINDER_DEFAULT_HOURS),
      },
      update: patch,
    });
    return this.prefView(saved);
  }

  private prefView(pref: Awaited<ReturnType<TenantRequestContext['tenantDb']['notificationPreference']['findUnique']>>) {
    return {
      emailEnabled: pref?.emailEnabled ?? true,
      smsEnabled: pref?.smsEnabled ?? false,
      soundEnabled: pref?.soundEnabled ?? true,
      categoryPrefs: sanitizeCategoryPrefs(pref?.categoryPrefs),
      quietHoursEnabled: pref?.quietHoursEnabled ?? false,
      quietStart: pref?.quietStart ?? '22:00',
      quietEnd: pref?.quietEnd ?? '07:00',
      smsFallbackEnabled: pref?.smsFallbackEnabled ?? false,
      toastEnabled: pref?.toastEnabled ?? true,
      reminderEnabled: pref?.reminderEnabled ?? true,
      reminderAfterHours: clampReminderHours(pref?.reminderAfterHours ?? REMINDER_DEFAULT_HOURS),
    };
  }

  // ── Web Push ──────────────────────────────────────────────────────────────
  @Get('push/vapid-public-key')
  getPushPublicKey() {
    return { publicKey: this.push.getPublicKey(), configured: this.push.isConfigured(), keyHash: this.push.currentKeyHash() };
  }

  /** ثبت/تازه‌سازی اشتراک همین دستگاه. dedupe بر اساس endpoint؛ اگر endpoint قبلاً مال کاربر دیگری روی همین دستگاه بود به کاربر فعلی منتقل می‌شود. */
  @Post('push/subscribe')
  async subscribePush(@Body() dto: SubscribePushDto, @Ctx() ctx: TenantRequestContext, @Headers('user-agent') ua?: string) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { success: false };
    limit(subscribeLimiter, userId);
    if (!isAllowedPushEndpoint(dto.endpoint)) throw new BadRequestException('این نشانی سرویس پوش پشتیبانی نمی‌شود');
    const now = new Date();
    const label = dto.label?.trim() || deviceLabelFromUserAgent(ua);
    const keyHash = this.push.currentKeyHash();
    const sub = await ctx.tenantDb.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: { userId, endpoint: dto.endpoint, p256dh: dto.p256dh, auth: dto.auth, label, userAgent: (ua ?? '').slice(0, 300), lastSeenAt: now, vapidKeyHash: keyHash },
      update: {
        userId,
        p256dh: dto.p256dh,
        auth: dto.auth,
        lastSeenAt: now,
        failureCount: 0,
        vapidKeyHash: keyHash,
        userAgent: (ua ?? '').slice(0, 300),
        // نام دلخواهِ قبلی با ثبت مجدد خودکار پاک نشود
        ...(dto.label?.trim() ? { label: dto.label.trim() } : {}),
      },
    });
    return { success: true, id: sub.id, label: sub.label, rotateToken: await this.push.issueRotateToken(ctx.tenantDb, sub.id, userId, ctx.tenantId, ctx.auth.sub), keyHash };
  }

  /** حذف اشتراک همین دستگاه (خروج از حساب / خاموش‌کردن). فقط اشتراک‌های خود کاربر. */
  @Delete('push/subscribe')
  async unsubscribePush(@Query('endpoint') endpoint: string, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId || !endpoint) return { success: true };
    await ctx.tenantDb.pushSubscription.deleteMany({ where: { endpoint, userId } });
    return { success: true };
  }

  /** وضعیت اشتراک‌های کاربر + اینکه endpoint فعلیِ مرورگر روی سرور ثبت است یا نه (برای عیب‌یابی). */
  @Get('push/status')
  async pushStatus(@Query('endpoint') endpoint: string | undefined, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    const keyHash = this.push.currentKeyHash();
    const base = { configured: this.push.isConfigured(), publicKey: this.push.getPublicKey(), keyHash, serverTime: new Date().toISOString() };
    if (!userId) return { ...base, devices: [], currentRegistered: false };
    const subs = await ctx.tenantDb.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    const devices = subs.map((s) => ({
      id: s.id,
      label: s.label ?? 'دستگاه ناشناس',
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      lastSuccessAt: s.lastSuccessAt,
      lastFailureAt: s.lastFailureAt,
      lastRotateAt: s.lastRotateAt,
      failureCount: s.failureCount,
      vapidMismatch: Boolean(s.vapidKeyHash && keyHash && s.vapidKeyHash !== keyHash),
      isCurrent: Boolean(endpoint && s.endpoint === endpoint),
    }));
    return { ...base, devices, currentRegistered: devices.some((d) => d.isCurrent) };
  }

  @Patch('push/devices/:id')
  async renameDevice(@Param('id') id: string, @Body() dto: RenameDeviceDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { success: false };
    const r = await ctx.tenantDb.pushSubscription.updateMany({ where: { id, userId }, data: { label: dto.label.trim() } });
    return { success: r.count === 1 };
  }

  @Delete('push/devices/:id')
  async removeDevice(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { success: false };
    const r = await ctx.tenantDb.pushSubscription.deleteMany({ where: { id, userId } });
    return { success: r.count === 1 };
  }

  /** اعلان آزمایشی به یک دستگاه یا همه‌ی دستگاه‌های خود کاربر. نتیجه‌ی رسیدن را با GET push/test/:id پیگیری کنید. */
  @Post('push/test')
  async sendTest(@Body() dto: PushTestDto, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { success: false };
    limit(testLimiter, userId);
    const row = await ctx.tenantDb.notification.create({
      data: {
        userId,
        type: 'system.test',
        category: 'system',
        title: 'اعلان آزمایشی اکسیر',
        body: 'اگر این پیام را می‌بینید، پوش روی این دستگاه درست کار می‌کند ✓',
        link: '/settings/notifications/diagnostics',
        readAt: new Date(), // نخوانده‌ی کاذب نسازد و زنگوله آن را «درون‌برنامه تحویل‌شده» ثبت نکند
      },
    });
    const summary = await this.push.sendToTenantUser(
      ctx.tenantDb,
      userId,
      { title: 'اعلان آزمایشی اکسیر', body: 'اگر این پیام را می‌بینید، پوش روی این دستگاه درست کار می‌کند ✓', url: '/settings/notifications/diagnostics', tag: 'push-test' },
      { category: 'system', critical: true, notificationId: row.id, onlySubscriptionId: dto.subscriptionId },
    );
    return {
      success: true,
      notificationId: row.id,
      configured: this.push.isConfigured(),
      total: summary.total,
      sent: summary.sent,
      failed: summary.failed,
      skipped: summary.skipped,
      results: summary.results.map((r) => ({ ...r, explanation: FAILURE_REASON_FA[r.reason] ?? r.reason })),
    };
  }

  @Get('push/test/:id')
  async testResult(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    const n = userId ? await ctx.tenantDb.notification.findFirst({ where: { id, userId, type: 'system.test' }, select: { deliveredAt: true, deliveredVia: true } }) : null;
    if (!n) throw new NotFoundException();
    return { delivered: Boolean(n.deliveredAt), deliveredAt: n.deliveredAt, via: n.deliveredVia };
  }

  /** ۲۰ تلاش اخیر ارسال برای خود کاربر (کدهای HTTP و دلیل فارسی). */
  @Get('push/attempts')
  async attempts(@Ctx() ctx: TenantRequestContext) {
    const userId = await resolveTenantUserId(ctx);
    if (!userId) return { items: [] };
    const rows = await ctx.tenantDb.pushAttempt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    const subs = await ctx.tenantDb.pushSubscription.findMany({ where: { userId }, select: { id: true, label: true } });
    const labelOf = new Map(subs.map((s) => [s.id, s.label]));
    return {
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        channel: r.channel,
        category: r.category,
        status: r.status,
        httpCode: r.httpCode,
        reason: r.reason,
        explanation: FAILURE_REASON_FA[r.reason ?? ''] ?? r.reason ?? '',
        deliveredAt: r.deliveredAt,
        device: (r.subscriptionId && labelOf.get(r.subscriptionId)) || (r.channel === 'sms' ? 'پیامک' : 'دستگاه حذف‌شده'),
      })),
      keyHash: vapidKeyHash(this.push.getPublicKey()),
    };
  }
}
