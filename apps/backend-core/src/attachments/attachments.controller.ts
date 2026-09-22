import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { CreateAttachmentDto } from './dto/create-attachment.dto.js';

/**
 * پیوست فایل عمومی — قابل اتصال به هر موجودیتی (فاکتور، مخاطب، سفارش خرید،
 * تیکت...) با entityType/entityId. فایل واقعی (تا حدود ۱۱ مگابایت) به‌صورت
 * data URI مستقیم در ستون fileUrl ذخیره می‌شود — همان الگویی که در این
 * کدبیس برای تصاویر (رزومه، لوگو، گواهی‌نامه و...) استفاده شده؛ بدون
 * زیرساخت آپلود/فضای ذخیره‌ی جدا (S3 و مانند آن). fileUrl می‌تواند یک لینک
 * خارجی معمولی هم باشد (برای فایل‌های بزرگ‌تر که کاربر خودش جایی بار گذاشته).
 * دسترسی به دیدن/حذف پیوست هر موجودیت، همان دسترسی دیدن خود موجودیت است که
 * کاربر از قبل برای باز کردن صفحه‌ی جزئیاتش داشته — این ماژول عمداً یک
 * لایه‌ی مجوز جداگانه روی entityType پیاده نمی‌کند.
 */
@Controller('attachments')
@UseGuards(JwtAuthGuard)
export class AttachmentsController {
  @Get()
  async list(@Query('entityType') entityType: string, @Query('entityId') entityId: string, @Ctx() ctx: TenantRequestContext) {
    return ctx.tenantDb.attachment.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { name: true } } },
    });
  }

  @Post()
  async create(@Body() dto: CreateAttachmentDto, @Ctx() ctx: TenantRequestContext) {
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
    await ctx.tenantDb.attachment.delete({ where: { id } });
    return { success: true };
  }
}
