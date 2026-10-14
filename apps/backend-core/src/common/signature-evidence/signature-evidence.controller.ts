import { BadRequestException, ForbiddenException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard.js';
import { Ctx } from '../decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../request-context.js';
import { PermissionsService } from '../../permissions/permissions.service.js';
import { contractScope, proposalScope } from '../../permissions/entity-scopes.js';
import { assertInScope } from '../../permissions/scope.util.js';
import { SignatureEvidenceService } from './signature-evidence.service.js';

/** نوع موجودیت → کد ماژول برای کنترل دسترسی مشاهده. */
export const EVIDENCE_ENTITY_MODULE: Record<string, string> = {
  contract: 'contracts',
  contract_amendment: 'contracts',
  contract_witness: 'contracts',
  proposal: 'proposals',
  quotation: 'sales',
  invoice: 'sales',
  invoice_delivery: 'sales',
  recruitment_offer: 'recruitment',
  ration_sample: 'ration-lab',
  shipment: 'dispatch',
  shipment_offer: 'fleet',
};

@Controller('signature-evidence')
@UseGuards(JwtAuthGuard)
export class SignatureEvidenceController {
  constructor(
    private readonly evidence: SignatureEvidenceService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get()
  async list(@Query('entityType') entityType: string, @Query('entityId') entityId: string, @Ctx() ctx: TenantRequestContext) {
    if (entityType === 'approval') {
      // مدرک تأیید با مهر/امضا فقط برای مالک/مدیر
      if (!entityId) throw new BadRequestException('نوع یا شناسه‌ی موجودیت نامعتبر است');
      if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') throw new ForbiddenException('اجازه‌ی مشاهده‌ی این بخش را ندارید');
    } else {
      const mod = EVIDENCE_ENTITY_MODULE[entityType ?? ''];
      if (!mod || !entityId) throw new BadRequestException('نوع یا شناسه‌ی موجودیت نامعتبر است');
      await this.permissions.assertView(ctx, mod);
    }
    if (entityType === 'contract') {
      await assertInScope(ctx.tenantDb.contract, await contractScope(this.permissions, ctx), { id: entityId }, { message: 'رکورد یافت نشد' });
    } else if (entityType === 'proposal') {
      await assertInScope(ctx.tenantDb.proposal, await proposalScope(this.permissions, ctx), { id: entityId }, { message: 'رکورد یافت نشد' });
    } else {
      // برای بقیه‌ی انواع محدوده‌ی «فقط مال خودم» تعریف نشده؛ شواهد (آی‌پی/موقعیت/دستگاه) فقط با دسترسی «مشاهده‌ی همه» دیده شود
      await this.permissions.assertViewAll(ctx, EVIDENCE_ENTITY_MODULE[entityType]);
    }
    const rows = await this.evidence.listFor(ctx, entityType, entityId);
    return rows.map((r) => ({ ...r, integrityOk: this.evidence.verify(r) }));
  }
}
