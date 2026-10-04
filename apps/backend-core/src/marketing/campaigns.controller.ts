import { Body, Controller, Delete, Get, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { assertInScope } from '../permissions/scope.util.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { CampaignsService } from './campaigns.service.js';
import { CreateCampaignDto } from './dto/create-campaign.dto.js';
import { UpdateCampaignDto } from './dto/update-campaign.dto.js';
import { PreviewAudienceDto } from './dto/audience-filter.dto.js';

@Controller('marketing/campaigns')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('marketing')
export class CampaignsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly campaigns: CampaignsService,
  ) {}

  /** کاربر «فقط خودم» فقط کمپین‌های ساخته‌ی خودش را می‌بیند/تغییر می‌دهد؛ خارج از دامنه → ۴۰۴. */
  private async scope(ctx: TenantRequestContext) {
    return this.permissions.viewScope(ctx, 'marketing', 'createdByUserId');
  }

  private async assertCampaignInScope(ctx: TenantRequestContext, id: string) {
    await assertInScope(ctx.tenantDb.marketingCampaign, await this.scope(ctx), { id }, { message: 'کمپین یافت نشد' });
  }

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    return this.campaigns.list(ctx, await this.scope(ctx));
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.campaigns.detail(ctx, id, await this.scope(ctx));
  }

  @Post('preview-audience')
  async previewAudience(@Body() dto: PreviewAudienceDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'marketing');
    return this.campaigns.previewAudience(ctx, dto.filter);
  }

  @Post()
  async create(@Body() dto: CreateCampaignDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'marketing');
    const userId = await resolveTenantUserId(ctx);
    return this.campaigns.create(ctx, dto, userId ?? undefined);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'marketing');
    await this.assertCampaignInScope(ctx, id);
    return this.campaigns.update(ctx, id, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'marketing');
    await this.assertCampaignInScope(ctx, id);
    return this.campaigns.delete(ctx, id);
  }

  @Post(':id/send')
  async send(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'marketing');
    await this.assertCampaignInScope(ctx, id);
    return this.campaigns.send(ctx, id);
  }

  @Get(':id/image')
  async image(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.assertCampaignInScope(ctx, id);
    const png = await this.campaigns.renderTemplateImage(ctx, id);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }
}
