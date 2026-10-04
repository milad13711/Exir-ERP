import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { CreateSampleDto } from './dto/create-sample.dto.js';
import { UpdateSampleDto } from './dto/update-sample.dto.js';
import { RationReportPdfService } from './ration-report-pdf.service.js';

export const SAMPLE_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true } },
  collectedBy: { select: { id: true, name: true } },
  lines: true,
  labReport: true,
  followUps: { orderBy: { scheduledAt: 'asc' as const } },
} as const;

/** ویرایش/حذف/ارسال‌به‌آزمایشگاه فقط پیش از تأیید تحویل آزمایشگاه مجاز است — بعد از آن، آزمایشگاه روی داده کار کرده. */
const EDITABLE_STATUSES = new Set(['COLLECTED', 'IN_TRANSIT']);

@Controller('ration-lab/samples')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('ration-lab')
export class RationSamplesController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
    private readonly pdf: RationReportPdfService,
  ) {}

  @Get()
  async list(@Query('status') status: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'ration-lab');
    return ctx.tenantDb.rationSample.findMany({
      where: status ? { status: status as never } : undefined,
      include: SAMPLE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async get(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'ration-lab');
    const sample = await ctx.tenantDb.rationSample.findUnique({ where: { id }, include: SAMPLE_INCLUDE });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    return sample;
  }

  @Post()
  async create(@Body() dto: CreateSampleDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'ration-lab');

    const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id: dto.contactId } });
    if (!contact) throw new NotFoundException('دامدار (مخاطب) یافت نشد');

    let discountPercent = 0;
    const analysisFeeAmount = dto.analysisFeeAmount ?? 0;
    if (dto.discountCode) {
      const discount = await ctx.tenantDb.rationDiscountCode.findUnique({ where: { code: dto.discountCode } });
      if (!discount || !discount.isActive) throw new BadRequestException('کد تخفیف نامعتبر است');
      if (discount.expiresAt && discount.expiresAt < new Date()) throw new BadRequestException('کد تخفیف منقضی شده است');
      if (discount.maxRedemptions != null && discount.redemptionCount >= discount.maxRedemptions) {
        throw new BadRequestException('سقف استفاده از این کد تخفیف پر شده است');
      }
      discountPercent = discount.percentOff;
      await ctx.tenantDb.rationDiscountCode.update({ where: { id: discount.id }, data: { redemptionCount: { increment: 1 } } });
    }
    const finalFeeAmount = Math.round(analysisFeeAmount * (1 - discountPercent / 100));

    const userId = await resolveTenantUserId(ctx);

    const sample = await ctx.tenantDb.rationSample.create({
      data: {
        contactId: dto.contactId,
        collectedByUserId: userId,
        collectedAt: new Date(dto.collectedAt),
        herdSize: dto.herdSize,
        totalHerdMilkYieldLiters: dto.totalHerdMilkYieldLiters,
        avgMilkYieldPerAnimalLiters: dto.avgMilkYieldPerAnimalLiters,
        milkFatPercent: dto.milkFatPercent,
        milkProteinPercent: dto.milkProteinPercent,
        currentRationDescription: dto.currentRationDescription,
        consentSignatureDataUrl: dto.consentSignatureDataUrl,
        consentAcceptedAt: new Date(),
        analysisFeeAmount,
        discountCode: dto.discountCode,
        discountPercent,
        finalFeeAmount,
        isIdentityVisibleToLab: dto.isIdentityVisibleToLab ?? true,
        lines: dto.currentLines?.length
          ? {
              create: dto.currentLines.map((l) => ({
                kind: 'CURRENT',
                ingredientName: l.ingredientName,
                quantityPerAnimalKg: l.quantityPerAnimalKg,
                unitCostSnapshot: l.unitCostSnapshot,
                lineCost: Math.round(l.quantityPerAnimalKg * l.unitCostSnapshot),
              })),
            }
          : undefined,
      },
      include: SAMPLE_INCLUDE,
    });

    return sample;
  }

  @Post(':id/mark-in-transit')
  async markInTransit(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'ration-lab');
    await this.permissions.assertViewAll(ctx, 'ration-lab'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    const sample = await ctx.tenantDb.rationSample.findUnique({ where: { id } });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    if (sample.status !== 'COLLECTED') throw new BadRequestException('این نمونه از قبل به آزمایشگاه منتقل شده است');
    return ctx.tenantDb.rationSample.update({ where: { id }, data: { status: 'IN_TRANSIT' }, include: SAMPLE_INCLUDE });
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSampleDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'ration-lab');
    await this.permissions.assertViewAll(ctx, 'ration-lab'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    const sample = await ctx.tenantDb.rationSample.findUnique({ where: { id } });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    if (!EDITABLE_STATUSES.has(sample.status)) {
      throw new ForbiddenException('بعد از تأیید تحویل آزمایشگاه، اطلاعات نمونه دیگر قابل ویرایش نیست');
    }

    let discountPercent = sample.discountPercent;
    const analysisFeeAmount = dto.analysisFeeAmount ?? sample.analysisFeeAmount;
    if (dto.discountCode !== undefined && dto.discountCode !== sample.discountCode) {
      if (dto.discountCode) {
        const discount = await ctx.tenantDb.rationDiscountCode.findUnique({ where: { code: dto.discountCode } });
        if (!discount || !discount.isActive) throw new BadRequestException('کد تخفیف نامعتبر است');
        discountPercent = discount.percentOff;
      } else {
        discountPercent = 0;
      }
    }
    const finalFeeAmount = Math.round(analysisFeeAmount * (1 - discountPercent / 100));

    if (dto.currentLines) {
      await ctx.tenantDb.rationFormulaLine.deleteMany({ where: { sampleId: id, kind: 'CURRENT' } });
    }

    return ctx.tenantDb.rationSample.update({
      where: { id },
      data: {
        collectedAt: dto.collectedAt ? new Date(dto.collectedAt) : undefined,
        herdSize: dto.herdSize,
        totalHerdMilkYieldLiters: dto.totalHerdMilkYieldLiters,
        avgMilkYieldPerAnimalLiters: dto.avgMilkYieldPerAnimalLiters,
        milkFatPercent: dto.milkFatPercent,
        milkProteinPercent: dto.milkProteinPercent,
        currentRationDescription: dto.currentRationDescription,
        analysisFeeAmount,
        discountCode: dto.discountCode,
        discountPercent,
        finalFeeAmount,
        lines: dto.currentLines?.length
          ? {
              create: dto.currentLines.map((l) => ({
                kind: 'CURRENT',
                ingredientName: l.ingredientName,
                quantityPerAnimalKg: l.quantityPerAnimalKg,
                unitCostSnapshot: l.unitCostSnapshot,
                lineCost: Math.round(l.quantityPerAnimalKg * l.unitCostSnapshot),
              })),
            }
          : undefined,
      },
      include: SAMPLE_INCLUDE,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'ration-lab');
    await this.permissions.assertViewAll(ctx, 'ration-lab'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    const sample = await ctx.tenantDb.rationSample.findUnique({ where: { id } });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    if (!EDITABLE_STATUSES.has(sample.status)) {
      throw new ForbiddenException('بعد از تأیید تحویل آزمایشگاه، این نمونه دیگر قابل حذف نیست');
    }
    await ctx.tenantDb.rationSample.delete({ where: { id } });
    return { success: true };
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertViewAll(ctx, 'ration-lab');
    const sample = await ctx.tenantDb.rationSample.findUnique({
      where: { id },
      include: {
        contact: { select: { name: true } },
        lines: true,
        labReport: true,
        followUps: { where: { completedAt: { not: null } }, orderBy: { scheduledAt: 'asc' } },
      },
    });
    if (!sample) throw new NotFoundException('نمونه یافت نشد');
    if (!sample.labReport) throw new BadRequestException('هنوز گزارش آزمایشگاه برای این نمونه ثبت نشده است');
    const tenant = await this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });

    const trend = [
      { label: 'نمونه‌ی اولیه', avgMilkYieldPerAnimalLiters: sample.avgMilkYieldPerAnimalLiters ? Number(sample.avgMilkYieldPerAnimalLiters) : null },
      ...sample.followUps.map((f) => ({
        label: `${f.dueOffsetDays} روز بعد`,
        avgMilkYieldPerAnimalLiters: f.avgMilkYieldPerAnimalLiters ? Number(f.avgMilkYieldPerAnimalLiters) : null,
      })),
    ];

    const pdf = await this.pdf.render(
      {
        sampleNo: sample.sampleNo,
        collectedAt: sample.collectedAt,
        farmerName: sample.contact.name,
        currentLines: sample.lines.filter((l) => l.kind === 'CURRENT').map((l) => ({ ...l, quantityPerAnimalKg: Number(l.quantityPerAnimalKg) })),
        proposedLines: sample.lines.filter((l) => l.kind === 'PROPOSED').map((l) => ({ ...l, quantityPerAnimalKg: Number(l.quantityPerAnimalKg) })),
        currentRationIssues: sample.labReport.currentRationIssues,
        riskIfUnchanged: sample.labReport.riskIfUnchanged,
        newRecommendations: sample.labReport.newRecommendations,
        expectedResult: sample.labReport.expectedResult,
        urgentWarningSigns: sample.labReport.urgentWarningSigns,
        trend,
      },
      tenant.name,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ration-report-${sample.sampleNo}.pdf"`);
    res.send(pdf);
  }
}
