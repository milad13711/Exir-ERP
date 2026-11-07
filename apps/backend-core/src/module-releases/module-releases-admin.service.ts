import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ModuleReleaseFanoutService } from './module-release-fanout.service.js';
import {
  ALLOWED_ROUTE_ROOTS,
  LIMITS,
  MODULE_ROUTES,
  ReleaseValidationError,
  RELEASE_TYPES,
  cleanChanges,
  isValidVersion,
  isRetryable,
  newShortCode,
  normalizeChannels,
  plainText,
  type ChannelSelection,
  type CleanChange,
} from './module-release.logic.js';
import type { CreateModuleReleaseDto, UpdateModuleReleaseDto } from './dto/module-release.dto.js';

const isUnique = (e: unknown) => (e as { code?: string } | null)?.code === 'P2002';

@Injectable()
export class ModuleReleasesAdminService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly fanout: ModuleReleaseFanoutService,
  ) {}

  async meta() {
    const modules = await this.controlDb.moduleDefinition.findMany({ select: { code: true, name: true, version: true }, orderBy: { name: 'asc' } });
    return {
      modules: modules.map((m) => ({ ...m, route: MODULE_ROUTES[m.code] ?? null })),
      routeRoots: [...ALLOWED_ROUTE_ROOTS].sort(),
      types: RELEASE_TYPES,
      limits: LIMITS,
    };
  }

  async list(q: { status?: string; moduleCode?: string }) {
    const rows = await this.controlDb.moduleRelease.findMany({
      where: { ...(q.status === 'DRAFT' || q.status === 'PUBLISHED' ? { status: q.status } : {}), ...(q.moduleCode ? { moduleCode: q.moduleCode } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      include: { _count: { select: { changes: true } } },
    });
    const mods = await this.controlDb.moduleDefinition.findMany({ select: { code: true, name: true } });
    const name = new Map(mods.map((m) => [m.code, m.name]));
    return rows.map(({ _count, ...r }) => ({ ...r, moduleName: name.get(r.moduleCode) ?? r.moduleCode, changeCount: _count.changes }));
  }

  async get(id: string) {
    const r = await this.controlDb.moduleRelease.findUnique({ where: { id }, include: { changes: { orderBy: { sortOrder: 'asc' } } } });
    if (!r) throw new NotFoundException('انتشار یافت نشد');
    const mod = await this.controlDb.moduleDefinition.findUnique({ where: { code: r.moduleCode }, select: { name: true } });
    return { ...r, moduleName: mod?.name ?? r.moduleCode };
  }

  private clean(changes: unknown): CleanChange[] {
    try {
      return cleanChanges(changes);
    } catch (e) {
      if (e instanceof ReleaseValidationError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  async create(dto: CreateModuleReleaseDto, adminId: string) {
    const mod = await this.controlDb.moduleDefinition.findUnique({ where: { code: dto.moduleCode }, select: { code: true } });
    if (!mod) throw new BadRequestException('ماژول نامعتبر است');
    const version = dto.version.trim();
    if (!isValidVersion(version)) throw new BadRequestException('شماره‌ی نسخه فقط می‌تواند حروف لاتین، عدد، نقطه و خط تیره باشد (مثل 1.4.0)');
    const title = plainText(dto.title, LIMITS.title);
    if (!title) throw new BadRequestException('عنوان انتشار الزامی است');
    const changes = this.clean(dto.changes);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const row = await this.controlDb.moduleRelease.create({
          data: {
            shortCode: newShortCode(),
            moduleCode: dto.moduleCode,
            version,
            title,
            summary: plainText(dto.summary, LIMITS.summary, true),
            createdByAdminId: adminId,
            changes: { create: changes.map((c, i) => ({ ...c, sortOrder: i })) },
          },
        });
        return this.get(row.id);
      } catch (e) {
        if (!isUnique(e)) throw e;
        const dup = await this.controlDb.moduleRelease.findUnique({ where: { moduleCode_version: { moduleCode: dto.moduleCode, version } }, select: { id: true } });
        if (dup) throw new ConflictException('برای این ماژول قبلاً انتشاری با همین نسخه ثبت شده است');
        // برخورد کد کوتاه: دوباره تلاش
      }
    }
    throw new ConflictException('ساخت کد کوتاه ممکن نشد؛ دوباره تلاش کنید');
  }

  async update(id: string, dto: UpdateModuleReleaseDto) {
    const cur = await this.controlDb.moduleRelease.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!cur) throw new NotFoundException('انتشار یافت نشد');
    // پس از انتشار، متن تغییرات برای تننت‌ها ارسال/دیده شده و نباید بی‌صدا عوض شود
    if (cur.status !== 'DRAFT') throw new ConflictException('فقط انتشارِ پیش‌نویس قابل ویرایش است؛ انتشارِ منتشرشده تغییر نمی‌کند.');
    const data: { title?: string; summary?: string } = {};
    if (dto.title !== undefined) {
      const t = plainText(dto.title, LIMITS.title);
      if (!t) throw new BadRequestException('عنوان انتشار الزامی است');
      data.title = t;
    }
    if (dto.summary !== undefined) data.summary = plainText(dto.summary, LIMITS.summary, true);
    const changes = dto.changes !== undefined ? this.clean(dto.changes) : null;
    await this.controlDb.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.moduleRelease.update({ where: { id }, data });
      if (changes) {
        await tx.moduleReleaseChange.deleteMany({ where: { releaseId: id } });
        await tx.moduleReleaseChange.createMany({ data: changes.map((c, i) => ({ ...c, releaseId: id, sortOrder: i })) });
      }
    });
    return this.get(id);
  }

  async remove(id: string) {
    const r = await this.controlDb.moduleRelease.findUnique({ where: { id }, select: { status: true } });
    if (!r) throw new NotFoundException('انتشار یافت نشد');
    if (r.status !== 'DRAFT') throw new BadRequestException('فقط پیش‌نویس قابل حذف است؛ انتشار منتشرشده در سابقه می‌ماند');
    await this.controlDb.moduleRelease.delete({ where: { id } });
    return { success: true };
  }

  /** پیش‌نمایش گیرندگان: چند تننت ماژول را فعال دارند، چند تا پیامک‌پذیرند و چند تا انصراف داده‌اند. */
  async recipients(id: string) {
    const r = await this.controlDb.moduleRelease.findUnique({ where: { id }, select: { moduleCode: true } });
    if (!r) throw new NotFoundException('انتشار یافت نشد');
    const tenants = await this.fanout.eligibleTenants(r.moduleCode);
    let smsReady = 0;
    let optedOutNotify = 0;
    let optedOutTicket = 0;
    let optedOutSms = 0;
    for (const t of tenants) {
      try {
        const db = this.fanout.dbOf(t);
        const prefs = await this.fanout.getPrefs(db);
        if (!prefs.notify) optedOutNotify++;
        if (!prefs.ticket) optedOutTicket++;
        if (!prefs.sms) optedOutSms++;
        if (prefs.sms && (await this.fanout.hasSmsChannel(db))) smsReady++;
      } catch {
        /* تننت در دسترس نیست؛ در شمارش پیامک نمی‌آید */
      }
    }
    return { tenants: tenants.length, smsReady, optedOut: { notify: optedOutNotify, ticket: optedOutTicket, sms: optedOutSms }, sample: tenants.slice(0, 20).map((t) => ({ id: t.id, name: t.name, slug: t.slug })) };
  }

  async publish(id: string, channelsIn: unknown, adminId: string) {
    const channels: ChannelSelection = normalizeChannels(channelsIn);
    const r = await this.controlDb.moduleRelease.findUnique({ where: { id }, include: { _count: { select: { changes: true } } } });
    if (!r) throw new NotFoundException('انتشار یافت نشد');
    if (r._count.changes === 0) throw new BadRequestException('حداقل یک تغییر برای انتشار لازم است');
    // انتقال اتمیک DRAFT → PUBLISHED؛ دو کلیک هم‌زمان فقط یک بار پخش را شروع می‌کند
    const moved = await this.controlDb.moduleRelease.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedByAdminId: adminId, channels: channels as never },
    });
    if (moved.count === 0) throw new ConflictException('این انتشار قبلاً منتشر شده است؛ برای ارسال مجدد از «ارسال دوباره» استفاده کنید');
    void this.fanout.run(id, { retry: false }).catch(() => undefined);
    return { success: true, channels };
  }

  /** «ارسال دوباره به کسانی که نگرفتند»: فقط ردیف‌های ناموفق/نیمه‌کاره/متروک/قابل‌تکرار؛ موفق‌ها هرگز دوباره نمی‌روند. */
  async retry(id: string) {
    const r = await this.controlDb.moduleRelease.findUnique({ where: { id }, select: { status: true } });
    if (!r) throw new NotFoundException('انتشار یافت نشد');
    if (r.status !== 'PUBLISHED') throw new BadRequestException('این انتشار هنوز منتشر نشده است');
    if (this.fanout.isRunning(id)) throw new ConflictException('پخش این انتشار هم‌اکنون در حال اجراست');
    void this.fanout.run(id, { retry: true }).catch(() => undefined);
    return { success: true };
  }

  async testSend(id: string, tenantId: string, channelsIn: unknown) {
    const channels = normalizeChannels(channelsIn);
    if (!channels.notify && !channels.ticket && !channels.sms) throw new BadRequestException('حداقل یک کانال را برای آزمایش انتخاب کنید');
    try {
      return await this.fanout.testSend(id, tenantId, channels);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (m === 'NOT_FOUND') throw new NotFoundException('انتشار یافت نشد');
      if (m === 'TENANT_NOT_ACTIVE') throw new BadRequestException('تننت انتخاب‌شده فعال نیست');
      throw e;
    }
  }

  /** گزارش تحویل به تفکیک تننت و کانال. */
  async report(id: string) {
    const r = await this.controlDb.moduleRelease.findUnique({ where: { id }, select: { id: true, moduleCode: true, status: true, channels: true } });
    if (!r) throw new NotFoundException('انتشار یافت نشد');
    const rows = await this.controlDb.moduleReleaseDelivery.findMany({ where: { releaseId: id, channel: { not: 'TEST' } }, orderBy: { updatedAt: 'desc' } });
    const tenantIds = [...new Set(rows.map((x) => x.tenantId))];
    const tenants = await this.controlDb.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true, slug: true } });
    const byId = new Map(tenants.map((t) => [t.id, t]));
    const now = new Date();
    const totals: Record<string, Record<string, number>> = {};
    const perTenant = new Map<string, { tenantId: string; name: string; slug: string; channels: Record<string, unknown> }>();
    for (const row of rows) {
      (totals[row.channel] ??= {})[row.status] = ((totals[row.channel] ??= {})[row.status] ?? 0) + 1;
      const t = byId.get(row.tenantId);
      const entry = perTenant.get(row.tenantId) ?? { tenantId: row.tenantId, name: t?.name ?? row.tenantId, slug: t?.slug ?? '', channels: {} };
      entry.channels[row.channel] = { status: row.status, sent: row.sentCount, failed: row.failedCount, reason: row.reason, attempts: row.attempts, ticketId: row.ticketId, finishedAt: row.finishedAt, retryable: isRetryable(row, now) };
      perTenant.set(row.tenantId, entry);
    }
    const retryableCount = rows.filter((x) => isRetryable(x, now)).length;
    return { release: r, running: this.fanout.isRunning(id), totals, retryableCount, tenants: [...perTenant.values()].sort((a, b) => a.name.localeCompare(b.name, 'fa')) };
  }
}
