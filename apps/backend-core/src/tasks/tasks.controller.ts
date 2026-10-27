import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { CreateChecklistItemDto, UpdateChecklistItemDto } from './dto/checklist-item.dto.js';
import {
  CommentDto,
  ExtensionDecisionDto,
  ExtensionRequestDto,
  NoteDto,
  ProblemDto,
  ReassignDto,
  RequiredNoteDto,
  ResolveProblemDto,
  SubmitResultDto,
  TaskSettingsDto,
  MarkDeliveredDto,
} from './dto/task-actions.dto.js';
import { TasksService, type TaskListFilters } from './tasks.service.js';

/**
 * گردش‌کار وظایف. دامنه‌ی دید: مدیر همه؛ بقیه فقط سازنده/ارجاع‌گیرنده (۴۰۴ خارج از دامنه).
 * اقدام‌های ارجاع‌گیرنده: seen/start/result/problem/extension-requests. اقدام‌های سازنده/مدیر: approve/return/resolve-problem/reassign/cancel/reopen/PATCH.
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(
    @Query() query: TaskListFilters & Record<string, string | undefined>,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.tasks.list(ctx, {
      assigneeId: query.assigneeId,
      status: query.status,
      priority: query.priority,
      from: query.from,
      to: query.to,
      dateField: query.dateField,
      q: query.q,
      relatedModule: query.relatedModule,
      relatedEntityId: query.relatedEntityId,
      mine: query.mine,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  /** تیک «دریافت‌شد»: کلاینت وقتی کارت وظیفه‌ی ارجاع‌شده به کاربر نمایان شد شناسه‌ها را می‌فرستد (فقط ردیف خود کاربر). */
  @Post('delivered')
  delivered(@Body() dto: MarkDeliveredDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.markDeliveredExplicit(ctx, dto.ids);
  }

  @Get('summary')
  summary(@Query('assigneeId') assigneeId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.summary(ctx, assigneeId);
  }

  @Get('settings')
  getSettings(@Ctx() ctx: TenantRequestContext) {
    return this.tasks.getSettings(ctx);
  }

  @Put('settings')
  updateSettings(@Body() dto: TaskSettingsDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.updateSettings(ctx, dto.numberPrefix);
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.create(ctx, dto);
  }

  @Get(':id')
  detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.detail(ctx, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.remove(ctx, id);
  }

  /** سازگاری با تیک قدیمی. */
  @Post(':id/toggle')
  toggle(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.toggle(ctx, id);
  }

  // ── ارجاع‌گیرنده ──
  @Post(':id/seen')
  seen(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.markSeen(ctx, id);
  }

  @Post(':id/start')
  start(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.start(ctx, id);
  }

  @Post(':id/result')
  result(@Param('id') id: string, @Body() dto: SubmitResultDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.submitResult(ctx, id, dto);
  }

  @Post(':id/problem')
  problem(@Param('id') id: string, @Body() dto: ProblemDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.reportProblem(ctx, id, dto);
  }

  @Post(':id/comments')
  comment(@Param('id') id: string, @Body() dto: CommentDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.addComment(ctx, id, dto);
  }

  @Post(':id/extension-requests')
  requestExtension(@Param('id') id: string, @Body() dto: ExtensionRequestDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.requestExtension(ctx, id, dto);
  }

  // ── سازنده/مدیر ──
  @Post(':id/extension-requests/:requestId/approve')
  approveExtension(@Param('id') id: string, @Param('requestId') requestId: string, @Body() dto: ExtensionDecisionDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.decideExtension(ctx, id, requestId, true, dto);
  }

  @Post(':id/extension-requests/:requestId/reject')
  rejectExtension(@Param('id') id: string, @Param('requestId') requestId: string, @Body() dto: ExtensionDecisionDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.decideExtension(ctx, id, requestId, false, dto);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() dto: NoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.approve(ctx, id, dto);
  }

  @Post(':id/return')
  returnForFix(@Param('id') id: string, @Body() dto: RequiredNoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.returnForFix(ctx, id, dto);
  }

  @Post(':id/resolve-problem')
  resolveProblem(@Param('id') id: string, @Body() dto: ResolveProblemDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.resolveProblem(ctx, id, dto);
  }

  @Post(':id/reassign')
  reassign(@Param('id') id: string, @Body() dto: ReassignDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.reassign(ctx, id, dto);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: NoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.cancel(ctx, id, dto);
  }

  @Post(':id/reopen')
  reopen(@Param('id') id: string, @Body() dto: NoteDto, @Ctx() ctx: TenantRequestContext) {
    return this.tasks.reopen(ctx, id, dto);
  }

  // ── چک‌لیست ──
  @Post(':id/checklist')
  async addChecklistItem(@Param('id') id: string, @Body() dto: CreateChecklistItemDto, @Ctx() ctx: TenantRequestContext) {
    await this.tasks.assertChecklistAccess(ctx, id);
    const last = await ctx.tenantDb.taskChecklistItem.findFirst({ where: { taskId: id }, orderBy: { order: 'desc' } });
    return ctx.tenantDb.taskChecklistItem.create({ data: { taskId: id, text: dto.text.trim(), order: (last?.order ?? -1) + 1 } });
  }

  @Patch(':id/checklist/:itemId')
  async updateChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.tasks.assertChecklistAccess(ctx, id);
    await this.requireChecklistItem(ctx, id, itemId);
    return ctx.tenantDb.taskChecklistItem.update({
      where: { id: itemId },
      data: { ...(dto.text !== undefined ? { text: dto.text.trim() } : {}), ...(dto.done !== undefined ? { done: dto.done } : {}) },
    });
  }

  @Delete(':id/checklist/:itemId')
  async removeChecklistItem(@Param('id') id: string, @Param('itemId') itemId: string, @Ctx() ctx: TenantRequestContext) {
    await this.tasks.assertChecklistAccess(ctx, id);
    await this.requireChecklistItem(ctx, id, itemId);
    await ctx.tenantDb.taskChecklistItem.delete({ where: { id: itemId } });
    return { success: true };
  }

  private async requireChecklistItem(ctx: TenantRequestContext, taskId: string, itemId: string) {
    const item = await ctx.tenantDb.taskChecklistItem.findFirst({ where: { id: itemId, taskId } });
    if (!item) throw new NotFoundException('آیتم چک‌لیست یافت نشد');
    return item;
  }
}
