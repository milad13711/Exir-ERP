import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';

@Controller('tasks')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('tasks')
export class TasksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  async list(
    @Query('relatedModule') relatedModule: string | undefined,
    @Query('relatedEntityId') relatedEntityId: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    const scope = await this.permissions.viewScope(ctx, 'tasks', 'assignedUserId');
    return ctx.tenantDb.task.findMany({
      where: { ...scope, ...(relatedModule ? { relatedModule } : {}), ...(relatedEntityId ? { relatedEntityId } : {}) },
      include: { assignee: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  async create(@Body() dto: CreateTaskDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'tasks');
    const creatorUserId = await resolveTenantUserId(ctx);

    let assignedUserId = creatorUserId;
    if (dto.assignedUserId && dto.assignedUserId !== creatorUserId) {
      const assignee = await ctx.tenantDb.user.findUnique({ where: { id: dto.assignedUserId } });
      if (!assignee) throw new BadRequestException('کاربر انتخاب‌شده برای ارجاع یافت نشد');
      assignedUserId = assignee.id;
    }

    const task = await ctx.tenantDb.task.create({
      data: {
        title: dto.title,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
        priority: dto.priority ?? 'NORMAL',
        assignedUserId,
        relatedModule: dto.relatedModule,
        relatedEntityId: dto.relatedEntityId,
      },
      include: { assignee: { select: { name: true } } },
    });
    await ctx.tenantDb.activityLog.create({
      data: {
        userId: creatorUserId,
        action: 'task.created',
        entityType: 'Task',
        entityId: task.id,
      },
    });
    await this.webhooks.dispatch(ctx.tenantId, 'task.created', {
      id: task.id,
      title: task.title,
      priority: task.priority,
    });
    if (assignedUserId && assignedUserId !== creatorUserId) {
      await this.notifications.notify(ctx.tenantDb, {
        userId: assignedUserId,
        type: 'task.assigned',
        title: `یک وظیفه به شما ارجاع شد: «${task.title}»`,
        body: task.relatedModule ? `مرتبط با ${task.relatedModule}` : 'برای پیگیری',
        link: '/tasks',
      });
    }
    return task;
  }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tasks');
    const task = await ctx.tenantDb.task.findUniqueOrThrow({ where: { id } });
    return ctx.tenantDb.task.update({
      where: { id },
      data:
        task.status === 'DONE'
          ? { status: 'OPEN', completedAt: null }
          : { status: 'DONE', completedAt: new Date() },
      include: { assignee: { select: { name: true } } },
    });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'tasks');
    const existing = await ctx.tenantDb.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('وظیفه یافت نشد');

    let assignedUserId = existing.assignedUserId;
    if (dto.assignedUserId !== undefined && dto.assignedUserId !== existing.assignedUserId) {
      const assignee = await ctx.tenantDb.user.findUnique({ where: { id: dto.assignedUserId } });
      if (!assignee) throw new BadRequestException('کاربر انتخاب‌شده برای ارجاع یافت نشد');
      assignedUserId = assignee.id;
    }

    const task = await ctx.tenantDb.task.update({
      where: { id },
      data: {
        title: dto.title,
        priority: dto.priority,
        assignedUserId,
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt ? new Date(dto.dueAt) : null } : {}),
      },
      include: { assignee: { select: { name: true } } },
    });

    if (assignedUserId && assignedUserId !== existing.assignedUserId) {
      const actorUserId = await resolveTenantUserId(ctx);
      if (assignedUserId !== actorUserId) {
        await this.notifications.notify(ctx.tenantDb, {
          userId: assignedUserId,
          type: 'task.assigned',
          title: `یک وظیفه به شما ارجاع شد: «${task.title}»`,
          body: task.relatedModule ? `مرتبط با ${task.relatedModule}` : 'برای پیگیری',
          link: '/tasks',
        });
      }
    }
    return task;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'tasks');
    const existing = await ctx.tenantDb.task.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('وظیفه یافت نشد');
    await ctx.tenantDb.task.delete({ where: { id } });
    return { success: true };
  }
}
