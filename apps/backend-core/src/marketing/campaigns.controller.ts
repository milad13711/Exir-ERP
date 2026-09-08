import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CampaignsService } from './campaigns.service.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';
import { PreviewAudienceDto } from './dto/audience-filter.dto.js';

@Controller('marketing/campaigns')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('marketing')
export class CampaignsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    return this.campaigns.list(ctx);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.campaigns.detail(ctx, id);
  }

  @Post('preview-audience')
  async previewAudience(@Body() dto: PreviewAudienceDto, @Ctx() ctx: TenantRequestContext) {
    return this.campaigns.previewAudience(ctx, dto.filter);
  }

  @Post()
  async create(@Body() dto: CreateCampaignDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'marketing');
    const userId = await resolveTenantUserId(ctx);
    return this.campaigns.create(ctx, dto, userId ?? undefined);
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'marketing');
    return this.campaigns.send(ctx, id);
  }

  @Get(':id/image')
  async image(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const png = await this.campaigns.renderTemplateImage(ctx, id);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }
}
