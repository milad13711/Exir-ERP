import { Body, Controller, Delete, Get, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
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
import { CertificateImageService } from './certificate-image.service.js';
import { CreateCertificateDto } from './dto/create-certificate.dto.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';

function webPanelPublicUrl(): string {
  return (process.env.WEB_PANEL_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function certificateVerifyUrl(tenantSlug: string, code: string): string {
  return `${webPanelPublicUrl()}/certificate/${tenantSlug}/${code}`;
}

@Controller('hr/certificates')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class CertificatesController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
    private readonly image: CertificateImageService,
    private readonly stamp: CompanyStampService,
  ) {}

  @Get()
  async list(@Query('employeeId') employeeId: string | undefined, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    return ctx.tenantDb.certificate.findMany({
      where: employeeId ? { employeeId } : {},
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } }, issuedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'hr');
    const cert = await ctx.tenantDb.certificate.findUnique({
      where: { id },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } }, issuedBy: { select: { id: true, name: true } } },
    });
    if (!cert) throw new NotFoundException('این گواهی یافت نشد');
    return { ...cert, verifyUrl: certificateVerifyUrl(ctx.tenantSlug, cert.code) };
  }

  @Post()
  async create(@Body() dto: CreateCertificateDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    const employee = await ctx.tenantDb.employee.findUnique({ where: { id: dto.employeeId } });
    if (!employee) throw new NotFoundException('این کارمند یافت نشد');

    const code = await generateCertificateCode(ctx);
    const issuedByUserId = await resolveTenantUserId(ctx).catch(() => undefined);

    const cert = await ctx.tenantDb.certificate.create({
      data: {
        code,
        employeeId: dto.employeeId,
        recipientNameFa: dto.recipientNameFa?.trim() || employee.fullName,
        recipientNameEn: dto.recipientNameEn,
        courseTitleFa: dto.courseTitleFa,
        courseTitleEn: dto.courseTitleEn,
        durationHours: dto.durationHours,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        score: dto.score,
        issuedByUserId,
      },
      include: { employee: { select: { id: true, fullName: true, employeeCode: true } } },
    });
    return { ...cert, verifyUrl: certificateVerifyUrl(ctx.tenantSlug, cert.code) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    const cert = await ctx.tenantDb.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('این گواهی یافت نشد');
    await ctx.tenantDb.certificate.delete({ where: { id } });
    return { ok: true };
  }

  @Get(':id/image.png')
  async downloadImage(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertViewAll(ctx, 'hr');
    const png = await this.renderImage(id, ctx);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }

  private async renderImage(id: string, ctx: TenantRequestContext): Promise<Buffer> {
    const cert = await ctx.tenantDb.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('این گواهی یافت نشد');
    const [tenant, seal] = await Promise.all([
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      this.stamp.getStamp(ctx),
    ]);
    return this.image.render(cert, tenant.name, certificateVerifyUrl(ctx.tenantSlug, cert.code), seal);
  }

}
