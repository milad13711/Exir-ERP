import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AttachmentAccessService } from './attachment-access.service.js';
import { CreateAttachmentDto } from './dto/create-attachment.dto.js';

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
  constructor(private readonly access: AttachmentAccessService) {}

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
    return ctx.tenantDb.attachment.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        title: dto.title,
        fileUrl: dto.fileUrl,
        createdByUserId: userId,
      },
      include: { createdBy: { select: { name: true } } },
    });
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
