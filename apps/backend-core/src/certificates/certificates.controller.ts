import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { generateCertificateCode } from './certificate-code.util.js';
import { CertificateRenderService, type CertificateForRender } from './certificate-render.service.js';
import { CertificateTemplateSettingsService, type CertificateTemplateSettings } from './certificate-template-settings.service.js';
import { CreateCertificateDto } from './dto/create-certificate.dto.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import { maxItemsFor, toAsciiDigits } from './certificate-text.util.js';
import { certificateVerifyUrl } from './certificate-verify-url.js';

const INCLUDE = {
  employee: { select: { id: true, fullName: true, employeeCode: true } },
  crmContact: { select: { id: true, name: true } },
  issuedBy: { select: { id: true, name: true } },
  items: { orderBy: { order: 'asc' as const } },
};

function toRenderModel(cert: {
  code: string;
  recipientNameFa: string;
  recipientNameEn: string | null;
  nationalId: string | null;
  titleFa: string;
  titleEn: string | null;
  durationHours: number | null;
  startDate: Date | null;
  endDate: Date | null;
  score: number | null;
  issuedByName: string | null;
  createdAt: Date;
  items: { titleFa: string; titleEn: string | null }[];
}): CertificateForRender {
  return {
    code: cert.code,
    recipientNameFa: cert.recipientNameFa,
    recipientNameEn: cert.recipientNameEn,
    nationalId: cert.nationalId,
    titleFa: cert.titleFa,
    titleEn: cert.titleEn,
    durationHours: cert.durationHours,
    startDate: cert.startDate,
    endDate: cert.endDate,
    score: cert.score,
    issuedByName: cert.issuedByName,
    createdAt: cert.createdAt,
    items: cert.items,
  };
}

function parseLang(value: string | undefined): 'fa' | 'en' {
  return value === 'en' ? 'en' : 'fa';
}

@Controller('certificates')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('certificates')
export class CertificatesController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
    private readonly render: CertificateRenderService,
    private readonly templateSettings: CertificateTemplateSettingsService,
    private readonly stamp: CompanyStampService,
  ) {}

  @Get()
  async list(
    @Query('employeeId') employeeId: string | undefined,
    @Query('crmContactId') crmContactId: string | undefined,
    @Query('search') search: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'certificates');
    const where: Record<string, unknown> = {};
    if (employeeId) where.employeeId = employeeId;
    if (crmContactId) where.crmContactId = crmContactId;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { recipientNameFa: { contains: q, mode: 'insensitive' } },
        { recipientNameEn: { contains: q, mode: 'insensitive' } },
      ];
    }
    return ctx.tenantDb.certificate.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('template-settings')
  async getTemplateSettings(@Ctx() ctx: TenantRequestContext): Promise<CertificateTemplateSettings> {
    await this.permissions.assertViewAll(ctx, 'certificates');
    const settings = await this.templateSettings.get(ctx);
    if (!settings.issuerCompanyNameFa) {
      // پیش‌فرض نام شرکت فارسی = نام سازمان در تنظیمات → عمومی
      const tenant = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
      settings.issuerCompanyNameFa = tenant?.name ?? '';
    }
    return settings;
  }

  @Put('template-settings')
  async updateTemplateSettings(@Body() dto: Partial<CertificateTemplateSettings>, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'certificates');
    return this.templateSettings.update(ctx, dto);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'certificates');
    const cert = await ctx.tenantDb.certificate.findUnique({ where: { id }, include: INCLUDE });
    if (!cert) throw new NotFoundException('این گواهی یافت نشد');
    return { ...cert, verifyUrl: certificateVerifyUrl(ctx.tenantSlug, cert.code) };
  }

  @Post()
  async create(@Body() dto: CreateCertificateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'certificates');

    if (dto.recipientType === 'EMPLOYEE' && !dto.employeeId) {
      throw new BadRequestException('برای گیرنده‌ی نوع «پرسنل» انتخاب کارمند الزامی است');
    }
    if (dto.recipientType === 'CONTACT' && !dto.crmContactId) {
      throw new BadRequestException('برای گیرنده‌ی نوع «مخاطب» انتخاب مخاطب الزامی است');
    }

    const recipientNameEn = dto.recipientNameEn.trim();
    if (recipientNameEn.length < 2) {
      throw new BadRequestException('نام انگلیسی گیرنده الزامی است (برای نسخه‌ی انگلیسی گواهی)');
    }
    const settings = await this.templateSettings.get(ctx);
    const itemCount = dto.items?.filter((it) => it.titleFa.trim()).length ?? 0;
    const maxItems = maxItemsFor(settings.itemsColumns);
    if (itemCount > maxItems) {
      throw new BadRequestException(`حداکثر ${maxItems} آیتم مجاز است (${settings.itemsColumns} ستون × ۴ ردیف)`);
    }

    let recipientNameFa: string;
    let recipientNationalId: string | null | undefined;
    let employeeId: string | undefined;
    let crmContactId: string | undefined;

    if (dto.recipientType === 'EMPLOYEE') {
      const employee = await ctx.tenantDb.employee.findUnique({ where: { id: dto.employeeId! } });
      if (!employee) throw new NotFoundException('این کارمند یافت نشد');
      recipientNameFa = employee.fullName;
      recipientNationalId = employee.nationalId;
      employeeId = employee.id;
    } else {
      const contact = await ctx.tenantDb.crmContact.findUnique({ where: { id: dto.crmContactId! } });
      if (!contact) throw new NotFoundException('این مخاطب یافت نشد');
      recipientNameFa = contact.name;
      recipientNationalId = contact.nationalId;
      crmContactId = contact.id;
    }

    const code = await generateCertificateCode(ctx);
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    let issuedByName: string | undefined;
    if (userId) {
      const user = await ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } });
      issuedByName = user?.name;
    }

    const cert = await ctx.tenantDb.certificate.create({
      data: {
        code,
        employeeId,
        crmContactId,
        recipientNameFa,
        recipientNameEn,
        nationalId: toAsciiDigits((dto.nationalId?.trim() || recipientNationalId || '').trim()) || undefined,
        titleFa: dto.titleFa,
        titleEn: dto.titleEn,
        durationHours: dto.durationHours,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        score: dto.score,
        issuedByUserId: userId ?? undefined,
        issuedByName,
        items: dto.items?.length
          ? { create: dto.items.map((it, index) => ({ titleFa: it.titleFa, titleEn: it.titleEn, order: index })) }
          : undefined,
      },
      include: INCLUDE,
    });
    return { ...cert, verifyUrl: certificateVerifyUrl(ctx.tenantSlug, cert.code) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'certificates');
    await this.permissions.assertViewAll(ctx, 'certificates'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    const cert = await ctx.tenantDb.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('این گواهی یافت نشد');
    await ctx.tenantDb.certificate.delete({ where: { id } });
    return { ok: true };
  }

  @Get(':id/image.png')
  async downloadImage(
    @Param('id') id: string,
    @Query('lang') lang: string | undefined,
    @Ctx() ctx: TenantRequestContext,
    @Res() res: Response,
  ) {
    await this.permissions.assertViewAll(ctx, 'certificates');
    const png = await this.renderBuffer(id, parseLang(lang), ctx, 'png');
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @Param('id') id: string,
    @Query('lang') lang: string | undefined,
    @Ctx() ctx: TenantRequestContext,
    @Res() res: Response,
  ) {
    await this.permissions.assertViewAll(ctx, 'certificates');
    const pdf = await this.renderBuffer(id, parseLang(lang), ctx, 'pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  }

  private async renderBuffer(id: string, lang: 'fa' | 'en', ctx: TenantRequestContext, kind: 'png' | 'pdf'): Promise<Buffer> {
    const cert = await ctx.tenantDb.certificate.findUnique({ where: { id }, include: { items: { orderBy: { order: 'asc' } } } });
    if (!cert) throw new NotFoundException('این گواهی یافت نشد');
    const [tenant, seal, settings] = await Promise.all([
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      this.stamp.getStamp(ctx),
      this.templateSettings.get(ctx),
    ]);
    const verifyUrl = certificateVerifyUrl(ctx.tenantSlug, cert.code);
    const model = toRenderModel(cert);
    return kind === 'png'
      ? this.render.renderPng(model, lang, tenant.name, verifyUrl, settings, seal)
      : this.render.renderPdf(model, lang, tenant.name, verifyUrl, settings, seal);
  }
}
