import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CreateLabReviewerDto, UpdateLabReviewerDto } from './dto/create-lab-reviewer.dto.js';

/** لیست سفید شماره‌هایی که پورتال عمومی «آزمایشگاه جیره» به‌عنوان کارشناس آزمایشگاه می‌پذیرد — بدون اکانت کامل در این تننت. */
@Controller('ration-lab/reviewers')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('ration-lab')
export class RationLabReviewersController {
  constructor(private readonly permissions: PermissionsService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'ration-lab');
    return ctx.tenantDb.rationLabReviewer.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async create(@Body() dto: CreateLabReviewerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'ration-lab');
    return ctx.tenantDb.rationLabReviewer.create({ data: { phone: dto.phone, name: dto.name } });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateLabReviewerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'ration-lab');
    const reviewer = await ctx.tenantDb.rationLabReviewer.findUnique({ where: { id } });
    if (!reviewer) throw new NotFoundException('کارشناس آزمایشگاه یافت نشد');
    return ctx.tenantDb.rationLabReviewer.update({ where: { id }, data: { name: dto.name, isActive: dto.isActive } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'ration-lab');
    const reviewer = await ctx.tenantDb.rationLabReviewer.findUnique({ where: { id } });
    if (!reviewer) throw new NotFoundException('کارشناس آزمایشگاه یافت نشد');
    await ctx.tenantDb.rationLabReviewer.delete({ where: { id } });
    return { success: true };
  }
}
