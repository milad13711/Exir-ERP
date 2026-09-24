import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ContractsService, contractPartyName, contractSecondPartyName } from './contracts.service.js';
import { ContractPdfService } from './contract-pdf.service.js';
import { CreateContractDto } from './dto/create-contract.dto.js';
import { UpdateContractDto } from './dto/update-contract.dto.js';
import { TerminateContractDto } from './dto/terminate-contract.dto.js';
import { RenewContractDto } from './dto/renew-contract.dto.js';
import { SaveContractTemplateDto } from './dto/save-contract-template.dto.js';
import { SignContractDto } from './dto/sign-contract.dto.js';
import { AddWitnessDto } from './dto/add-witness.dto.js';

@Controller('contracts')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly permissions: PermissionsService,
    private readonly pdf: ContractPdfService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  /** «مشاهده‌ی همه» = همه‌ی قراردادها؛ «فقط خودم» = قراردادهایی که خودش ساخته، امضای شرکتشان به او ارجاع شده یا قرارداد داخلی خودش است. */
  private async contractScope(ctx: TenantRequestContext): Promise<Record<string, unknown>> {
    const matrix = await this.permissions.getEffective(ctx, 'contracts');
    if (matrix.canViewAll) return {};
    if (!matrix.canViewOwn) throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    const userId = await resolveTenantUserId(ctx);
    return { OR: [{ createdByUserId: userId }, { referredSignerUserId: userId }, { employee: { userId } }] };
  }

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
    await this.permissions.assertViewAll(ctx, 'contracts');
    return this.contracts.expiringSoon(ctx);
  }

  @Get('categories')
  async listCategories(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.listCategories(ctx);
  }

  /** فقط برای پرکردن پیش‌نمایش امضای شرکت هنگام امضای قرارداد — تغییر خودِ مهر/امضا اکنون فقط از Settings → General (فقط مالک) ممکن است. */
  @Get('company-signature')
  async getCompanySignature(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'contracts');
    return this.contracts.getCompanySignature(ctx);
  }

  @Get()
  async list(
    @Query('type') type: string | undefined,
    @Query('status') status: string | undefined,
    @Query('contactId') contactId: string | undefined,
    @Query('legalCategory') legalCategory: string | undefined,
    @Query('category') category: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    return this.contracts.list(ctx, { type, status, contactId, legalCategory, category }, await this.contractScope(ctx));
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.contracts.detail(ctx, id, await this.contractScope(ctx));
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    const scope = await this.contractScope(ctx);
    const [contract, tenant, stamp] = await Promise.all([
      this.contracts.detail(ctx, id, scope),
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      this.contracts.getCompanySignature(ctx),
    ]);

    const pdf = await this.pdf.render(
      {
        contractNo: contract.contractNo,
        title: contract.title,
        status: contract.status,
        value: contract.value,
        startDate: contract.startDate,
        endDate: contract.endDate,
        terms: contract.terms,
        guaranteeTerms: contract.guaranteeTerms,
        isLocked: contract.isLocked,
        contentHash: contract.contentHash,
        partyASignerName: contract.partyASignerName,
        partyASignatureDataUrl: contract.partyASignatureDataUrl,
        partyASignedAt: contract.partyASignedAt,
        partyBSignerName: contract.partyBSignerName,
        partyBSignatureDataUrl: contract.partyBSignatureDataUrl,
        partyBSignedAt: contract.partyBSignedAt,
        partyBSignedAsDelegate: contract.partyBSignedAsDelegate,
        firstPartyName: contractPartyName(contract),
        secondPartyName: contractSecondPartyName(contract),
        witnesses: contract.witnesses,
      },
      tenant.name,
      stamp,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="contract-${contract.contractNo}.pdf"`);
    res.send(pdf);
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
    await this.permissions.assertViewAll(ctx, 'contracts');
    return this.contracts.listEditRequests(ctx, id);
  }

  @Post('edit-requests/:requestId/resolve')
  async resolveEditRequest(@Param('requestId') requestId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.resolveEditRequest(ctx, requestId);
  }

  @Get(':id/amendments')
  async amendments(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'contracts');
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

  @Get(':id/witnesses')
  async witnesses(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'contracts');
    return this.contracts.listWitnesses(ctx, id);
  }

  @Post(':id/witnesses')
  async addWitness(@Param('id') id: string, @Body() dto: AddWitnessDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    return this.contracts.addWitness(ctx, id, dto);
  }

  @Delete('witnesses/:witnessId')
  async removeWitness(@Param('witnessId') witnessId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'contracts');
    await this.contracts.removeWitness(ctx, witnessId);
    return { ok: true };
  }
}
