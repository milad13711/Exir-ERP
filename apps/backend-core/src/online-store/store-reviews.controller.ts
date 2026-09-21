import { Body, Controller, Get, NotFoundException, Param, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { UpdateReviewStatusDto } from './dto/update-review-status.dto.js';

/** تعدیل نظرات مشتری — نظر تازه با وضعیت PENDING ثبت می‌شود و تا تأیید اینجا در فروشگاه عمومی دیده نمی‌شود. */
@Controller('online-store/reviews')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('online-store')
export class StoreReviewsController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'online-store');
    return ctx.tenantDb.storeReview.findMany({
      where: status ? { status: status as never } : {},
      include: { product: { select: { name: true, publicSlug: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateReviewStatusDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'online-store');
    const review = await ctx.tenantDb.storeReview.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('نظر یافت نشد');
    return ctx.tenantDb.storeReview.update({ where: { id }, data: { status: dto.status } });
  }
}
