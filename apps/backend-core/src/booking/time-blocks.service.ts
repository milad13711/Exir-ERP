import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { BookingBlocksService } from './booking-blocks.service.js';
import { DEFAULT_BLOCK_PREFERENCES, validateManualBlockInput } from './booking-blocks.js';
import type { CreateTimeBlockDto, UpdateBookingPreferencesDto, UpdateTimeBlockDto } from './dto/time-block.dto.js';

export const MAX_BLOCKS_PER_USER = 200;
export const PREVIEW_DAYS = 14;
const PREVIEW_LIMIT = 100;

/**
 * ساعت‌های غیرفعال رزرو: هر کاربر مال خودش را مدیریت می‌کند؛ مدیریت برای کارشناس دیگر
 * فقط با «مشاهده‌ی همه» + «ویرایش» در ماژول booking (OWNER/ADMIN خودکار) مجاز است.
 */
@Injectable()
export class TimeBlocksService {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly blocks: BookingBlocksService,
  ) {}

  async canManageOthers(ctx: TenantRequestContext): Promise<boolean> {
    const m = await this.permissions.getEffective(ctx, 'booking');
    return m.canViewAll && m.canEdit;
  }

  /** کاربر هدف عملیات؛ برای دیگری بودن، دسترسی مدیریتی لازم است. */
  async resolveTarget(ctx: TenantRequestContext, requestedUserId?: string | null): Promise<string> {
    const me = await resolveTenantUserId(ctx);
    if (!requestedUserId || requestedUserId === me) {
      if (!me) throw new BadRequestException('کاربر معتبر یافت نشد');
      return me;
    }
    if (!(await this.canManageOthers(ctx))) throw new ForbiddenException('فقط مدیر می‌تواند ساعت‌های غیرفعال کارشناس دیگر را مدیریت کند');
    const target = await ctx.tenantDb.user.findUnique({ where: { id: requestedUserId }, select: { id: true } });
    if (!target) throw new NotFoundException('کارشناس یافت نشد');
    return target.id;
  }

  async overview(ctx: TenantRequestContext, requestedUserId?: string) {
    const userId = await this.resolveTarget(ctx, requestedUserId);
    const [blocks, preferences, canManageOthers] = await Promise.all([
      ctx.tenantDb.staffTimeBlock.findMany({ where: { userId }, orderBy: [{ startDate: 'desc' }, { startMinute: 'asc' }], take: MAX_BLOCKS_PER_USER }),
      this.getPreferences(ctx, userId),
      this.canManageOthers(ctx),
    ]);
    return { userId, canManageOthers, blocks, preferences };
  }

  async getPreferences(ctx: TenantRequestContext, userId: string) {
    const row = await ctx.tenantDb.staffBookingPreference.findUnique({ where: { userId } });
    return row
      ? { blockFromTasks: row.blockFromTasks, blockFromCalendar: row.blockFromCalendar, blockFromLeave: row.blockFromLeave }
      : { ...DEFAULT_BLOCK_PREFERENCES };
  }

  async updatePreferences(ctx: TenantRequestContext, dto: UpdateBookingPreferencesDto) {
    const userId = await this.resolveTarget(ctx, dto.userId);
    const data = {
      ...(dto.blockFromTasks !== undefined ? { blockFromTasks: dto.blockFromTasks } : {}),
      ...(dto.blockFromCalendar !== undefined ? { blockFromCalendar: dto.blockFromCalendar } : {}),
      ...(dto.blockFromLeave !== undefined ? { blockFromLeave: dto.blockFromLeave } : {}),
    };
    await ctx.tenantDb.staffBookingPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    return this.getPreferences(ctx, userId);
  }

  async create(ctx: TenantRequestContext, dto: CreateTimeBlockDto) {
    const userId = await this.resolveTarget(ctx, dto.userId);
    const input = { startDate: dto.startDate, endDate: dto.endDate, startMinute: dto.startMinute ?? null, endMinute: dto.endMinute ?? null, weekdays: dto.weekdays ?? [], reason: dto.reason ?? null };
    const err = validateManualBlockInput(input);
    if (err) throw new BadRequestException(err);
    const count = await ctx.tenantDb.staffTimeBlock.count({ where: { userId } });
    if (count >= MAX_BLOCKS_PER_USER) throw new BadRequestException(`حداکثر ${MAX_BLOCKS_PER_USER} ساعت غیرفعال برای هر کارشناس مجاز است؛ موارد قدیمی را حذف کنید`);
    const actor = await resolveTenantUserId(ctx);
    return ctx.tenantDb.staffTimeBlock.create({
      data: { userId, ...input, reason: input.reason?.trim() || null, createdByUserId: actor },
    });
  }

  private async loadOwned(ctx: TenantRequestContext, id: string) {
    const block = await ctx.tenantDb.staffTimeBlock.findUnique({ where: { id } });
    if (!block) throw new NotFoundException('ساعت غیرفعال یافت نشد');
    await this.resolveTarget(ctx, block.userId);
    return block;
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateTimeBlockDto) {
    const block = await this.loadOwned(ctx, id);
    const input = {
      startDate: dto.startDate ?? block.startDate,
      endDate: dto.endDate ?? block.endDate,
      startMinute: dto.startMinute !== undefined ? dto.startMinute : block.startMinute,
      endMinute: dto.endMinute !== undefined ? dto.endMinute : block.endMinute,
      weekdays: dto.weekdays ?? block.weekdays,
      reason: dto.reason !== undefined ? dto.reason : block.reason,
    };
    const err = validateManualBlockInput(input);
    if (err) throw new BadRequestException(err);
    return ctx.tenantDb.staffTimeBlock.update({ where: { id }, data: { ...input, reason: input.reason?.trim() || null } });
  }

  async remove(ctx: TenantRequestContext, id: string) {
    await this.loadOwned(ctx, id);
    await ctx.tenantDb.staffTimeBlock.delete({ where: { id } });
    return { ok: true };
  }

  /** پیش‌نمایش فقط‌خواندنی: بازه‌های خودکار (وظیفه/جلسه/مرخصی) ۱۴ روز آینده و دلیلشان. */
  async autoPreview(ctx: TenantRequestContext, requestedUserId?: string) {
    const userId = await this.resolveTarget(ctx, requestedUserId);
    const from = new Date();
    const to = new Date(from.getTime() + PREVIEW_DAYS * 24 * 3_600_000);
    const ranges = await this.blocks.loadBusyRanges(ctx, [userId], from, to);
    return ranges
      .filter((r) => r.source !== 'manual')
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .slice(0, PREVIEW_LIMIT)
      .map((r) => ({ startAt: r.start.toISOString(), endAt: r.end.toISOString(), source: r.source, reason: r.reason, allDay: r.source === 'leave' }));
  }
}
