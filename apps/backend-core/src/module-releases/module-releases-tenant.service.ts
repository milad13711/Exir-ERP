import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { enabledModuleSnapshot } from '../common/module-enabled.util.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { RELEASE_PREFS_KEY, defaultRouteFor, isSafeDeepLink, normalizePrefs, type TenantReleasePrefs } from './module-release.logic.js';

const RECENT_DAYS = 120;

/** سمت تننت: فقط انتشارهای PUBLISHED ماژول‌هایی که تننت واقعاً فعال دارد (همان منطق ModuleGuard). */
@Injectable()
export class ModuleReleasesTenantService {
  constructor(private readonly controlDb: ControlPrismaService) {}

  private async userId(ctx: TenantRequestContext): Promise<string> {
    const id = await resolveTenantUserId(ctx);
    if (!id) throw new ForbiddenException('این بخش برای کلید API مجاز نیست');
    return id;
  }

  private async enabledCodes(ctx: TenantRequestContext): Promise<{ codes: string[]; names: Map<string, string> }> {
    const snap = await enabledModuleSnapshot(this.controlDb, ctx.tenantId);
    const defs = await this.controlDb.moduleDefinition.findMany({ select: { code: true, name: true } });
    return { codes: [...snap.enabled], names: new Map(defs.map((d) => [d.code, d.name])) };
  }

  async list(ctx: TenantRequestContext) {
    const userId = await this.userId(ctx);
    const { codes, names } = await this.enabledCodes(ctx);
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const rows = await this.controlDb.moduleRelease.findMany({
      where: { status: 'PUBLISHED', moduleCode: { in: codes } },
      orderBy: { publishedAt: 'desc' },
      take: 100,
      select: { id: true, shortCode: true, moduleCode: true, version: true, title: true, summary: true, publishedAt: true, _count: { select: { changes: true } } },
    });
    const reads = await ctx.tenantDb.moduleReleaseRead.findMany({ where: { userId, releaseId: { in: rows.map((r) => r.id) } }, select: { releaseId: true } });
    const seen = new Set(reads.map((r) => r.releaseId));
    const items = rows.map(({ _count, ...r }) => ({
      ...r,
      moduleName: names.get(r.moduleCode) ?? r.moduleCode,
      changeCount: _count.changes,
      route: defaultRouteFor(r.moduleCode),
      unread: !seen.has(r.id) && !!r.publishedAt && r.publishedAt >= since,
    }));
    return { unreadCount: items.filter((i) => i.unread).length, items };
  }

  async unreadCount(ctx: TenantRequestContext): Promise<{ unreadCount: number }> {
    const userId = await this.userId(ctx);
    const { codes } = await this.enabledCodes(ctx);
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    const rows = await this.controlDb.moduleRelease.findMany({ where: { status: 'PUBLISHED', moduleCode: { in: codes }, publishedAt: { gte: since } }, select: { id: true }, take: 200 });
    if (!rows.length) return { unreadCount: 0 };
    const seen = await ctx.tenantDb.moduleReleaseRead.count({ where: { userId, releaseId: { in: rows.map((r) => r.id) } } });
    return { unreadCount: Math.max(0, rows.length - seen) };
  }

  /** با شناسه یا کد کوتاه. پیش‌نویس فقط وقتی دیده می‌شود که برای همین تننت «ارسال آزمایشی» شده باشد. */
  async detail(ctx: TenantRequestContext, idOrCode: string) {
    const userId = await this.userId(ctx);
    const r = await this.controlDb.moduleRelease.findFirst({
      where: { OR: [{ id: idOrCode }, { shortCode: idOrCode }] },
      include: { changes: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!r) throw new NotFoundException('این به‌روزرسانی یافت نشد');
    let visible = false;
    if (r.status === 'PUBLISHED') {
      const { codes } = await this.enabledCodes(ctx);
      visible = codes.includes(r.moduleCode);
    } else {
      visible = !!(await this.controlDb.moduleReleaseDelivery.findUnique({ where: { releaseId_tenantId_channel: { releaseId: r.id, tenantId: ctx.tenantId, channel: 'TEST' } }, select: { id: true } }));
    }
    // وجودِ ماژول برای این تننت را فاش نکنیم: همان پیام «یافت نشد»
    if (!visible) throw new NotFoundException('این به‌روزرسانی یافت نشد');
    const { names } = await this.enabledCodes(ctx);
    const route = defaultRouteFor(r.moduleCode);
    const read = await ctx.tenantDb.moduleReleaseRead.findUnique({ where: { userId_releaseId: { userId, releaseId: r.id } }, select: { id: true } });
    return {
      id: r.id,
      shortCode: r.shortCode,
      moduleCode: r.moduleCode,
      moduleName: names.get(r.moduleCode) ?? r.moduleCode,
      version: r.version,
      title: r.title,
      summary: r.summary,
      publishedAt: r.publishedAt,
      isDraftPreview: r.status !== 'PUBLISHED',
      route,
      unread: !read,
      changes: r.changes.map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        description: c.description,
        valueText: c.valueText,
        // لینک ذخیره‌شده دوباره هم با فهرست مجاز سنجیده می‌شود (دفاع در عمق)
        deepLink: c.deepLink && isSafeDeepLink(c.deepLink) ? c.deepLink : route,
      })),
    };
  }

  async markRead(ctx: TenantRequestContext, releaseId: string) {
    const userId = await this.userId(ctx);
    const exists = await this.controlDb.moduleRelease.findUnique({ where: { id: releaseId }, select: { id: true, status: true } });
    if (!exists || exists.status !== 'PUBLISHED') throw new NotFoundException('این به‌روزرسانی یافت نشد');
    await ctx.tenantDb.moduleReleaseRead.upsert({ where: { userId_releaseId: { userId, releaseId } }, create: { userId, releaseId }, update: {} });
    // اعلان درون‌برنامه‌ی مربوط هم خوانده شود
    await ctx.tenantDb.notification.updateMany({ where: { userId, entityType: 'module-release', entityId: releaseId, readAt: null }, data: { readAt: new Date() } });
    return { success: true };
  }

  async markAllRead(ctx: TenantRequestContext) {
    const userId = await this.userId(ctx);
    const { codes } = await this.enabledCodes(ctx);
    const rows = await this.controlDb.moduleRelease.findMany({ where: { status: 'PUBLISHED', moduleCode: { in: codes } }, select: { id: true }, take: 300 });
    if (rows.length) await ctx.tenantDb.moduleReleaseRead.createMany({ data: rows.map((r) => ({ userId, releaseId: r.id })), skipDuplicates: true });
    await ctx.tenantDb.notification.updateMany({ where: { userId, entityType: 'module-release', readAt: null }, data: { readAt: new Date() } });
    return { success: true };
  }

  async getPrefs(ctx: TenantRequestContext): Promise<TenantReleasePrefs> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: RELEASE_PREFS_KEY } });
    return normalizePrefs(row?.value);
  }

  async setPrefs(ctx: TenantRequestContext, input: Partial<TenantReleasePrefs>): Promise<TenantReleasePrefs> {
    const cur = await this.getPrefs(ctx);
    const value = normalizePrefs({ ...cur, ...input });
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: RELEASE_PREFS_KEY }, create: { ...RELEASE_PREFS_KEY, value: value as never }, update: { value: value as never } });
    return value;
  }
}
