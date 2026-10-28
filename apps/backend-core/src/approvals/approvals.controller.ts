import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { SignatureEvidenceService } from '../common/signature-evidence/signature-evidence.service.js';
import { hashContent } from '../common/signature-evidence/signature-evidence.util.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ApprovalsService } from './approvals.service.js';
import { SetModuleApproverDto } from './dto/set-module-approver.dto.js';
import { DecideApprovalDto } from './dto/decide-approval.dto.js';

/** کارتابل تأیید هر کاربر — مدیران همه‌ی اسناد، سایرین فقط اسناد ارجاع‌شده به خودشان. */
@Controller('approvals')
@UseGuards(JwtAuthGuard)
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly evidence: SignatureEvidenceService,
  ) {}

  @Get()
  list(@Ctx() ctx: TenantRequestContext, @Query('status') status?: string) {
    const s = status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED' ? status : undefined;
    return this.approvals.list(ctx, s);
  }

  @Get('module-approvers')
  moduleApprovers(@Ctx() ctx: TenantRequestContext) {
    return this.approvals.listModuleApprovers(ctx);
  }

  @Put('module-approvers/:moduleCode')
  setModuleApprover(@Param('moduleCode') moduleCode: string, @Body() dto: SetModuleApproverDto, @Ctx() ctx: TenantRequestContext) {
    return this.approvals.setModuleApprover(ctx, moduleCode, dto.userId ?? null);
  }

  @Get('pending-count')
  pendingCount(@Ctx() ctx: TenantRequestContext) {
    return this.approvals.pendingCount(ctx);
  }

  @Get(':id/detail')
  detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    return this.approvals.detail(ctx, id);
  }

  @Post(':id/decision')
  async decide(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Ctx() ctx: TenantRequestContext, @Req() req: Request) {
    const result = await this.approvals.decide(ctx, id, dto.approved, { withStamp: dto.withStamp, note: dto.note });
    // تأیید همراه مهر و امضای شرکت = امضای شرکت؛ مدرک حقوقی ثبت می‌شود (شکست ثبت، تصمیم را خراب نمی‌کند).
    if (dto.approved && dto.withStamp) {
      await this.evidence.tryRecord(ctx, {
        entityType: 'approval',
        entityId: id,
        action: 'approve_with_stamp',
        signerUserId: (await resolveTenantUserId(ctx).catch(() => null)) ?? undefined,
        signerRole: ctx.auth.role,
        contentHash: hashContent({ id, entityType: result.entityType, entityId: result.entityId, summary: result.summary }),
        req,
        clientEvidence: dto.evidence,
      });
    }
    // مدرک مخصوص نوع سند (مثل امضای فاکتور: IP/دستگاه/زمان/موقعیت) — شکست ثبت، تصمیم را خراب نمی‌کند.
    if (dto.approved && result.status === 'APPROVED') {
      const spec = await this.approvals.evidenceFor(ctx, result, { withStamp: !!dto.withStamp });
      if (spec) {
        await this.evidence.tryRecord(ctx, {
          ...spec,
          signerUserId: (await resolveTenantUserId(ctx).catch(() => null)) ?? undefined,
          signerRole: ctx.auth.role,
          req,
          clientEvidence: dto.evidence,
        });
      }
    }
    return result;
  }
}
