import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ModuleReleasesAdminService } from './module-releases-admin.service.js';
import { CreateModuleReleaseDto, PublishModuleReleaseDto, TestSendModuleReleaseDto, UpdateModuleReleaseDto } from './dto/module-release.dto.js';

/** مدیریت انتشار به‌روزرسانی ماژول‌ها — فقط ادمین پلتفرم (SUPER_ADMIN همیشه؛ تیم مهندسی برای نوشتن، پشتیبانی فقط خواندن). */
@Controller('admin/module-releases')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminModuleReleasesController {
  constructor(
    private readonly svc: ModuleReleasesAdminService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  private audit(ctx: AdminRequestContext, action: string, id: string, metadata: Record<string, unknown> = {}) {
    return this.controlDb.auditLog.create({ data: { actorType: 'admin_user', actorId: ctx.auth.sub, action, entityType: 'ModuleRelease', entityId: id, metadata: metadata as never } }).catch(() => undefined);
  }

  @Get('meta')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING', 'SUPPORT')
  meta() {
    return this.svc.meta();
  }

  @Get()
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING', 'SUPPORT')
  list(@Query('status') status?: string, @Query('moduleCode') moduleCode?: string) {
    return this.svc.list({ status, moduleCode });
  }

  @Get(':id')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING', 'SUPPORT')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  async create(@Body() dto: CreateModuleReleaseDto, @AdminCtx() ctx: AdminRequestContext) {
    const r = await this.svc.create(dto, ctx.auth.sub);
    await this.audit(ctx, 'module_release.created', r.id, { moduleCode: r.moduleCode, version: r.version });
    return r;
  }

  @Patch(':id')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  async update(@Param('id') id: string, @Body() dto: UpdateModuleReleaseDto, @AdminCtx() ctx: AdminRequestContext) {
    const r = await this.svc.update(id, dto);
    await this.audit(ctx, 'module_release.updated', id);
    return r;
  }

  @Delete(':id')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  async remove(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext) {
    const r = await this.svc.remove(id);
    await this.audit(ctx, 'module_release.deleted', id);
    return r;
  }

  @Get(':id/recipients')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING', 'SUPPORT')
  recipients(@Param('id') id: string) {
    return this.svc.recipients(id);
  }

  @Post(':id/publish')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  async publish(@Param('id') id: string, @Body() dto: PublishModuleReleaseDto, @AdminCtx() ctx: AdminRequestContext) {
    if (dto.confirm !== true) throw new BadRequestException('تأیید انتشار الزامی است');
    const r = await this.svc.publish(id, dto.channels, ctx.auth.sub);
    await this.audit(ctx, 'module_release.published', id, { channels: r.channels });
    return r;
  }

  @Post(':id/retry')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  async retry(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext) {
    const r = await this.svc.retry(id);
    await this.audit(ctx, 'module_release.retried', id);
    return r;
  }

  @Post(':id/test-send')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING')
  async testSend(@Param('id') id: string, @Body() dto: TestSendModuleReleaseDto, @AdminCtx() ctx: AdminRequestContext) {
    const r = await this.svc.testSend(id, dto.tenantId, dto.channels);
    await this.audit(ctx, 'module_release.test_sent', id, { tenantId: dto.tenantId, channels: dto.channels });
    return r;
  }

  @Get(':id/report')
  @AdminTeams('SUPER_ADMIN', 'ENGINEERING', 'SUPPORT')
  report(@Param('id') id: string) {
    return this.svc.report(id);
  }
}
