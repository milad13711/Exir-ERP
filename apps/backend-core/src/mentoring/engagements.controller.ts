import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { safeDelete } from '../common/safe-delete.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { EngagementsService } from './engagements.service.js';
import { CreateEngagementDto } from './dto/create-engagement.dto.js';
import { UpdateEngagementDto } from './dto/update-engagement.dto.js';

@Controller('mentoring/engagements')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('mentoring')
export class EngagementsController {
  constructor(
    private readonly engagements: EngagementsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('advisorUserId') advisorUserId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'mentoring');
    return this.engagements.list(ctx, { status, contactId, advisorUserId });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'mentoring');
    return this.engagements.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateEngagementDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'mentoring');
    return this.engagements.create(ctx, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'mentoring');
    await safeDelete(() => ctx.tenantDb.mentoringEngagement.delete({ where: { id } }));
    return { success: true };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEngagementDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.engagements.update(ctx, id, dto);
  }
}
