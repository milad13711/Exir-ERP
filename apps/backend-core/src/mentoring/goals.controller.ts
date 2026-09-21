import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { safeDelete } from '../common/safe-delete.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { GoalsService } from './goals.service.js';
import { CreateGoalDto } from './dto/create-goal.dto.js';
import { UpdateGoalDto } from './dto/update-goal.dto.js';
import { CreateGoalCheckInDto } from './dto/create-goal-checkin.dto.js';

@Controller('mentoring/goals')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('mentoring')
export class GoalsController {
  constructor(
    private readonly goals: GoalsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Post()
  async create(@Body() dto: CreateGoalDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'mentoring');
    return this.goals.create(ctx, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'mentoring');
    await safeDelete(() => ctx.tenantDb.mentoringGoal.delete({ where: { id } }));
    return { success: true };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateGoalDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.goals.update(ctx, id, dto);
  }

  @Post(':id/check-ins')
  async addCheckIn(@Param('id') id: string, @Body() dto: CreateGoalCheckInDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'mentoring');
    return this.goals.addCheckIn(ctx, id, dto);
  }
}
