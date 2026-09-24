import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { NavatelApiService } from './navatel-api.service.js';

/** گزارش‌های سانترال نواتل — شامل تمام تماس‌های شرکت، پس فقط برای مالک و مدیر. */
@Controller('voip/navatel')
@UseGuards(JwtAuthGuard, ModuleGuard, RolesGuard)
@RequireModule('voip')
@Roles('OWNER', 'ADMIN')
export class NavatelReportsController {
  constructor(private readonly navatel: NavatelApiService) {}

  @Get('cdr')
  cdr(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('caller') caller: string | undefined,
    @Query('destination') destination: string | undefined,
    @Query('callType') callType: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('limit') limit: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.navatel.cdr(ctx, { from, to, caller, destination, callType, offset: Number(offset) || 0, limit: Number(limit) || 20 });
  }

  @Get('stats')
  stats(@Query('from') from: string | undefined, @Query('to') to: string | undefined, @Ctx() ctx: TenantRequestContext) {
    return this.navatel.operatorStats(ctx, { from, to });
  }

  @Get('missed')
  missed(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('offset') offset: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.navatel.missedCalls(ctx, { from, to, offset: Number(offset) || 0 });
  }

  @Get('voicemails')
  voicemails(@Ctx() ctx: TenantRequestContext) {
    return this.navatel.voicemails(ctx);
  }

  @Get('voicemails/:uuid/messages')
  voicemailMessages(@Param('uuid') uuid: string, @Ctx() ctx: TenantRequestContext) {
    return this.navatel.voicemailMessages(ctx, uuid);
  }

  @Get('audio/:fileName')
  async audio(@Param('fileName') fileName: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const { buffer, contentType } = await this.navatel.download(ctx, fileName);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }
}
