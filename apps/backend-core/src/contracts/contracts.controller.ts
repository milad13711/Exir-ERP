import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ContractsService } from './contracts.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { TerminateContractDto } from './dto/terminate-contract.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { SaveContractTemplateDto } from './dto/save-contract-template.dto.js';
import { SignContractDto } from './dto/sign-contract.dto.js';

@Controller('contracts')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly permissions: PermissionsService,
  ) {}

  // نکته: مسیرهای ثابت (stage-templates‌مانند) باید قبل از مسیرهای پارامتری
  // ':id' ثبت شوند وگرنه اکسپرس آن‌ها را به‌عنوان مقدار ':id' تفسیر می‌کند
  // — همان تله‌ای که در employees.controller.ts/projects.controller.ts حل شد.

  @Get('templates')
  async listTemplates(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.listTemplates(ctx);
  }

  @Post('templates')
  async createTemplate(@Body() dto: SaveContractTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'contracts');
    return this.contracts.saveTemplate(ctx, dto);
  }

  @Patch('templates/:templateId')
  async updateTemplate(@Param('templateId') templateId: string, @Body() dto: SaveContractTemplateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.updateTemplate(ctx, templateId, dto);
  }

  @Delete('templates/:templateId')
  async deleteTemplate(@Param('templateId') templateId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'contracts');
    await this.contracts.deleteTemplate(ctx, templateId);
    return { ok: true };
  }

  @Get('expiring-soon')
  async expiringSoon(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.expiringSoon(ctx);
  }

  @Get()
  async list(
    @Query('type') type: string | undefined,
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('legalCategory') legalCategory: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.list(ctx, { type, status, contactId, legalCategory });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'contracts');
    return this.contracts.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.update(ctx, id, dto);
  }

  @Post(':id/sign')
  async sign(@Param('id') id: string, @Body() dto: SignContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.signAsCompany(ctx, id, dto);
  }

  @Post(':id/terminate')
  async terminate(@Param('id') id: string, @Body() dto: TerminateContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'contracts');
    return this.contracts.terminate(ctx, id, dto.reason);
  }

  @Post(':id/renew')
  async renew(@Param('id') id: string, @Body() dto: RenewContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.renew(ctx, id, dto.newEndDate);
  }

  @Get(':id/edit-requests')
  async editRequests(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.listEditRequests(ctx, id);
  }

  @Post('edit-requests/:requestId/resolve')
  async resolveEditRequest(@Param('requestId') requestId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.resolveEditRequest(ctx, requestId);
  }

  @Get(':id/amendments')
  async amendments(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.listAmendments(ctx, id);
  }

  @Post(':id/amendments')
  async createAmendment(@Param('id') id: string, @Body('text') text: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.createAmendment(ctx, id, text);
  }

  @Post('amendments/:amendmentId/sign')
  async signAmendment(@Param('amendmentId') amendmentId: string, @Body() dto: SignContractDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.signAmendmentAsCompany(ctx, amendmentId, dto);
  }
}
