import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AttachmentAccessService } from './attachment-access.service.js';
import { CreateAttachmentDto } from './dto/create-attachment.dto.js';
import { ConvertAttachmentDto, RenameAttachmentDto } from './dto/convert-attachment.dto.js';
import { AttachmentConversionService } from './attachment-conversion.service.js';
import { CHECKLIST_ITEM_ENTITY, normalizeChecklistAttachmentTitle } from '../daily-checklist/checklist-attachment.util.js';

/**
 * پیوست فایل عمومی — قابل اتصال به هر موجودیتی (فاکتور، مخاطب، سفارش خرید،
 * تیکت...) با entityType/entityId. فایل واقعی (تا حدود ۱۱ مگابایت) به‌صورت
 * data URI مستقیم در ستون fileUrl ذخیره می‌شود — همان الگویی که در این
 * کدبیس برای تصاویر (رزومه، لوگو، گواهی‌نامه و...) استفاده شده؛ بدون
 * زیرساخت آپلود/فضای ذخیره‌ی جدا (S3 و مانند آن). fileUrl می‌تواند یک لینک
 * خارجی معمولی هم باشد (برای فایل‌های بزرگ‌تر که کاربر خودش جایی بار گذاشته).
 * دسترسی به پیوست‌های هر موجودیت دقیقاً همان دسترسیِ خود موجودیت است
 * (AttachmentAccessService): دیدن = مجوز دیدنِ رکورد (با دامنه‌ی «فقط خودم»)،
 * افزودن/حذف = مجوز ویرایش همان ماژول روی رکوردی که کاربر می‌تواند ببیند.
 */
@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  constructor(
    private readonly access: AttachmentAccessService,
    private readonly conversion: AttachmentConversionService,
  ) {}

  @Get()
  async list(@Query('entityType') entityType: string, @Query('entityId') entityId: string, @Ctx() ctx: TenantRequestContext) {
    await this.access.assertAccess(ctx, entityType, entityId, 'read');
    return ctx.tenantDb.attachment.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true } } },
    });
  }

  @Post()
  async create(@Body() dto: CreateAttachmentDto, @Ctx() ctx: TenantRequestContext) {
    await this.access.assertAccess(ctx, dto.entityType, dto.entityId, 'write');
    const userId = await resolveTenantUserId(ctx);
    // فایلِ آیتم چک‌لیست باید حتماً یک نام انتخابیِ کاربر داشته باشد (نه نام خام فایل) و در همان آیتم یکتا باشد.
    let title = dto.title;
    if (dto.entityType === CHECKLIST_ITEM_ENTITY) {
      const siblings = await ctx.tenantDb.attachment.findMany({ where: { entityType: dto.entityType, entityId: dto.entityId }, select: { title: true } });
      title = normalizeChecklistAttachmentTitle(dto.title, siblings.map((s) => s.title));
    }
    return ctx.tenantDb.attachment.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        title,
        fileUrl: dto.fileUrl,
        createdByUserId: userId,
      },
      include: { createdBy: { select: { name: true } } },
    });
  }

  /** تغییر نام یک پیوست (مثلاً پیوست‌های قدیمیِ بدون نام مناسب). */
  @Patch(':id')
  async rename(@Param('id') id: string, @Body() dto: RenameAttachmentDto, @Ctx() ctx: TenantRequestContext) {
    const attachment = await ctx.tenantDb.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('پیوست یافت نشد');
    await this.access.assertAccess(ctx, attachment.entityType, attachment.entityId, 'write');
    let title = dto.title.trim();
    if (attachment.entityType === CHECKLIST_ITEM_ENTITY) {
      const siblings = await ctx.tenantDb.attachment.findMany({
        where: { entityType: attachment.entityType, entityId: attachment.entityId, id: { not: id } },
        select: { title: true },
      });
      title = normalizeChecklistAttachmentTitle(dto.title, siblings.map((s) => s.title));
    }
    return ctx.tenantDb.attachment.update({ where: { id }, data: { title }, include: { createdBy: { select: { name: true } } } });
  }

  /** تبدیل به دانش سازمانی (فقط با ماژول گزارش‌ها) */
  @Post(':id/convert-to-knowledge')
  convertToKnowledge(@Param('id') id: string, @Body() dto: ConvertAttachmentDto, @Ctx() ctx: TenantRequestContext) {
    return this.conversion.convert(ctx, id, 'KNOWLEDGE', { title: dto.title });
  }

  /** بایگانی در اسناد محرمانه (فقط با ماژول اسناد محرمانه) */
  @Post(':id/archive-confidential')
  archiveConfidential(@Param('id') id: string, @Body() dto: ConvertAttachmentDto, @Ctx() ctx: TenantRequestContext) {
    return this.conversion.convert(ctx, id, 'CONFIDENTIAL', { title: dto.title, category: dto.category });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    const attachment = await ctx.tenantDb.attachment.findUnique({ where: { id } });
    if (!attachment) throw new NotFoundException('پیوست یافت نشد');
    await this.access.assertAccess(ctx, attachment.entityType, attachment.entityId, 'delete');
    await ctx.tenantDb.attachment.delete({ where: { id } });
    return { success: true };
  }
}
