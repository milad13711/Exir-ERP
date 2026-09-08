import { Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreateGoalDto } from './dto/create-goal.dto.js';
import type { UpdateGoalDto } from './dto/update-goal.dto.js';
import type { CreateGoalCheckInDto } from './dto/create-goal-checkin.dto.js';

@Injectable()
export class GoalsService {
  async create(ctx: TenantRequestContext, dto: CreateGoalDto) {
    await ctx.tenantDb.mentoringEngagement.findUniqueOrThrow({ where: { id: dto.engagementId } });
    return ctx.tenantDb.mentoringGoal.create({
      data: {
        engagementId: dto.engagementId,
        title: dto.title,
        type: dto.type,
        unit: dto.unit,
        baselineValue: dto.baselineValue,
        targetValue: dto.targetValue,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
      },
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateGoalDto) {
    const existing = await ctx.tenantDb.mentoringGoal.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این هدف یافت نشد');
    return ctx.tenantDb.mentoringGoal.update({
      where: { id },
      data: {
        title: dto.title,
        unit: dto.unit,
        baselineValue: dto.baselineValue,
        targetValue: dto.targetValue,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        status: dto.status,
      },
    });
  }

  async addCheckIn(ctx: TenantRequestContext, goalId: string, dto: CreateGoalCheckInDto) {
    await ctx.tenantDb.mentoringGoal.findUniqueOrThrow({ where: { id: goalId } });
    return ctx.tenantDb.mentoringGoalCheckIn.create({
      data: { goalId, value: dto.value, note: dto.note, sessionId: dto.sessionId },
    });
  }
}
