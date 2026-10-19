import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { AdminCtx } from '../common/decorators/ctx.decorator.js';
import type { AdminRequestContext } from '../common/request-context.js';
import { clientIp } from '../security/client-ip.js';
import { LicenseAdminService, type Actor } from '../licensing/license-admin.service.js';
import {
  CreateLicenseAdminDto,
  LicenseSettingsDto,
  ListEventsQuery,
  ListLicensesQuery,
  OfflineTokenDto,
  ReasonDto,
  RenewLicenseDto,
  UpdateLicenseAdminDto,
} from '../licensing/license-admin.dto.js';

/**
 * مدیریت لایسنس برای تیم پلتفرم. فقط SUPER_ADMIN (مالک/ادمین ارشد) می‌تواند تغییر دهد؛
 * BILLING فقط فهرست/جزئیات را می‌بیند. ورود به کنسول ادمین مشمول ADMIN_REQUIRE_TOTP (2FA) است.
 * هیچ endpointی کلید خصوصی را برنمی‌گرداند (فقط kid و کلید عمومی).
 */
@Controller('admin/licenses')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminLicensesController {
  constructor(private readonly svc: LicenseAdminService) {}

  private actor(ctx: AdminRequestContext, req: Request): Actor {
    return { id: ctx.auth.sub, label: `admin:${ctx.auth.sub}`, ip: clientIp(req) };
  }

  /** BILLING فقط ۸ نویسه‌ی آخر کلید را می‌بیند؛ کلید کامل فقط SUPER_ADMIN. */
  private mask<T extends { licenseKey?: string | null }>(row: T, ctx: AdminRequestContext): T {
    if (ctx.auth.team === 'SUPER_ADMIN' || !row.licenseKey) return row;
    return { ...row, licenseKey: `•••${row.licenseKey.slice(-8)}` };
  }

  @Get()
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async list(@Query() q: ListLicensesQuery, @AdminCtx() ctx: AdminRequestContext) {
    const r = await this.svc.list(q);
    return { ...r, items: r.items.map((i) => this.mask(i, ctx)) };
  }

  @Get('export.csv')
  @AdminTeams('SUPER_ADMIN')
  async exportCsv(@Query() q: ListLicensesQuery, @Res() res: Response, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    await this.svc.recordKeyAccess('export', this.actor(ctx, req));
    const csv = await this.svc.exportCsv(q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="licenses.csv"');
    res.send(`﻿${csv}`);
  }

  @Get('settings')
  @AdminTeams('SUPER_ADMIN')
  getSettings() {
    return this.svc.getSettings();
  }

  @Patch('settings')
  @AdminTeams('SUPER_ADMIN')
  updateSettings(@Body() dto: LicenseSettingsDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.updateSettings(dto, this.actor(ctx, req));
  }

  @Get('events')
  @AdminTeams('SUPER_ADMIN')
  events(@Query() q: ListEventsQuery) {
    return this.svc.events(q);
  }

  @Get(':id')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  async get(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    const row = await this.svc.get(id);
    if (ctx.auth.team === 'SUPER_ADMIN') await this.svc.recordKeyAccess('view', this.actor(ctx, req), id);
    return this.mask(row, ctx);
  }

  @Post()
  @AdminTeams('SUPER_ADMIN')
  create(@Body() dto: CreateLicenseAdminDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.create(dto, this.actor(ctx, req));
  }

  @Patch(':id')
  @AdminTeams('SUPER_ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateLicenseAdminDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.update(id, dto, this.actor(ctx, req));
  }

  @Post(':id/renew')
  @AdminTeams('SUPER_ADMIN')
  renew(@Param('id') id: string, @Body() dto: RenewLicenseDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.renew(id, dto, this.actor(ctx, req));
  }

  @Post(':id/suspend')
  @AdminTeams('SUPER_ADMIN')
  suspend(@Param('id') id: string, @Body() dto: ReasonDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.suspend(id, dto.reason, this.actor(ctx, req));
  }

  @Post(':id/resume')
  @AdminTeams('SUPER_ADMIN')
  resume(@Param('id') id: string, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.resume(id, this.actor(ctx, req));
  }

  @Post(':id/revoke')
  @AdminTeams('SUPER_ADMIN')
  revoke(@Param('id') id: string, @Body() dto: ReasonDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.revoke(id, dto.reason, this.actor(ctx, req));
  }

  @Delete(':id')
  @AdminTeams('SUPER_ADMIN')
  remove(@Param('id') id: string, @Body() dto: ReasonDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.softDelete(id, dto.reason, this.actor(ctx, req));
  }

  @Get(':id/activations')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  activations(@Param('id') id: string) {
    return this.svc.listActivations(id);
  }

  @Delete(':id/activations/:activationId')
  @AdminTeams('SUPER_ADMIN')
  release(@Param('id') id: string, @Param('activationId') activationId: string, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.releaseActivation(id, activationId, this.actor(ctx, req));
  }

  @Post(':id/offline-token')
  @AdminTeams('SUPER_ADMIN')
  offlineToken(@Param('id') id: string, @Body() dto: OfflineTokenDto, @AdminCtx() ctx: AdminRequestContext, @Req() req: Request) {
    return this.svc.issueOfflineToken(id, dto, this.actor(ctx, req));
  }
}
