import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { CreateInternalTaskDto } from './dto/create-internal-task.dto.js';
import { CreateInternalLeadDto } from './dto/create-internal-lead.dto.js';
import { UpdateLeadStageDto } from './dto/update-lead-stage.dto.js';
import { AssignLeadDto } from './dto/assign-lead.dto.js';

const ALL_TEAMS = ['SUPER_ADMIN', 'SUPPORT', 'BILLING', 'ENGINEERING'] as const;

/**
 * Exir's own internal task/reminder board and sales pipeline for
 * prospective tenants — run from inside the admin panel, entirely separate
 * from any tenant's own Tasks/CRM module data. Open to every staff team;
 * there's no confidential-per-team split here the way tenant billing
 * actions have.
 */
@Controller('admin')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminInternalController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get('staff')
  @AdminTeams(...ALL_TEAMS)
  listStaff() {
    return this.controlDb.adminUser.findMany({
      where: { isActive: true },
      select: { id: true, name: true, team: true },
      orderBy: { name: 'asc' },
    });
  }

  // ── Internal tasks ────────────────────────────────────────────────────

  @Get('internal/tasks')
  @AdminTeams(...ALL_TEAMS)
  listTasks() {
    return this.controlDb.internalTask.findMany({
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }, { createdAt: 'desc' }],
      include: {
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  @Post('internal/tasks')
  @AdminTeams(...ALL_TEAMS)
  createTask(@Body() dto: CreateInternalTaskDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.controlDb.internalTask.create({
      data: {
        title: dto.title,
        description: dto.description,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        assignedToId: dto.assignedToId,
        createdById: ctx.auth.sub,
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  @Post('internal/tasks/:id/toggle')
  @AdminTeams(...ALL_TEAMS)
  async toggleTask(@Param('id') id: string) {
    const task = await this.controlDb.internalTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('وظیفه یافت نشد');
    const done = task.status === 'OPEN';
    return this.controlDb.internalTask.update({
      where: { id },
      data: { status: done ? 'DONE' : 'OPEN', completedAt: done ? new Date() : null },
      include: {
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  // ── Internal sales pipeline (leads) ──────────────────────────────────

  @Get('internal/leads')
  @AdminTeams(...ALL_TEAMS)
  listLeads() {
    return this.controlDb.internalLead.findMany({
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { id: true, name: true } } },
    });
  }

  @Post('internal/leads')
  @AdminTeams(...ALL_TEAMS)
  createLead(@Body() dto: CreateInternalLeadDto, @AdminCtx() ctx: AdminRequestContext) {
    return this.controlDb.internalLead.create({
      data: { ...dto, ownerAdminId: ctx.auth.sub },
      include: { owner: { select: { id: true, name: true } } },
    });
  }

  @Post('internal/leads/:id/stage')
  @AdminTeams(...ALL_TEAMS)
  async updateLeadStage(@Param('id') id: string, @Body() dto: UpdateLeadStageDto) {
    const lead = await this.controlDb.internalLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('فرصت فروش یافت نشد');
    return this.controlDb.internalLead.update({
      where: { id },
      data: { stage: dto.stage },
      include: { owner: { select: { id: true, name: true } } },
    });
  }

  @Post('internal/leads/:id/assign')
  @AdminTeams(...ALL_TEAMS)
  async assignLead(@Param('id') id: string, @Body() dto: AssignLeadDto) {
    const lead = await this.controlDb.internalLead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('فرصت فروش یافت نشد');
    return this.controlDb.internalLead.update({
      where: { id },
      data: { ownerAdminId: dto.ownerAdminId },
      include: { owner: { select: { id: true, name: true } } },
    });
  }
}
