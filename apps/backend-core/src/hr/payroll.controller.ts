import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { GeneratePayrollDto, UpdatePayrollDto } from './dto/payroll.dto.js';
import { UpdatePayrollTaxSettingsDto } from './dto/payroll-tax-settings.dto.js';
import { getPayrollTaxSettings, setPayrollTaxSettings, computePayrollDeductions } from './payroll-tax.js';
import { PayrollPdfService } from './payroll-pdf.service.js';

const employeeSelect = { select: { id: true, fullName: true, employeeCode: true, position: true } } as const;
const GENERAL_SETTINGS_MODULE = 'general';

@Controller('hr/payroll')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class PayrollController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
    private readonly pdf: PayrollPdfService,
  ) {}

  @Get('settings/tax-insurance')
  async getTaxSettings(@Ctx() ctx: TenantRequestContext) {
    return getPayrollTaxSettings(ctx.tenantDb);
  }

  @Put('settings/tax-insurance')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async setTaxSettings(@Body() dto: UpdatePayrollTaxSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await setPayrollTaxSettings(ctx.tenantDb, dto);
    return dto;
  }

  @Get()
  async list(
    @Query('year') year: string | undefined,
    @Query('month') month: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'hr');
    if (!year || !month) throw new BadRequestException('سال و ماه شمسی الزامی است');
    return ctx.tenantDb.payrollSlip.findMany({
      where: { periodYear: Number(year), periodMonth: Number(month) },
      include: { employee: employeeSelect },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('generate')
  async generate(@Body() dto: GeneratePayrollDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    const employees = await ctx.tenantDb.employee.findMany({ where: { status: 'ACTIVE' } });
    const existing = await ctx.tenantDb.payrollSlip.findMany({
      where: { periodYear: dto.year, periodMonth: dto.month },
      select: { employeeId: true },
    });
    const existingIds = new Set(existing.map((s) => s.employeeId));
    const missing = employees.filter((e) => !existingIds.has(e.id));

    if (missing.length > 0) {
      const taxSettings = await getPayrollTaxSettings(ctx.tenantDb);
      await ctx.tenantDb.payrollSlip.createMany({
        data: missing.map((e) => {
          const { insuranceAmount, taxAmount } = computePayrollDeductions(e.baseSalary, taxSettings);
          return {
            employeeId: e.id,
            periodYear: dto.year,
            periodMonth: dto.month,
            baseSalary: e.baseSalary,
            insuranceAmount,
            taxAmount,
          };
        }),
      });
    }

    return ctx.tenantDb.payrollSlip.findMany({
      where: { periodYear: dto.year, periodMonth: dto.month },
      include: { employee: employeeSelect },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post(':id')
  async update(@Param('id') id: string, @Body() dto: UpdatePayrollDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    const slip = await ctx.tenantDb.payrollSlip.findUnique({ where: { id } });
    if (!slip) throw new NotFoundException('فیش حقوقی یافت نشد');
    if (slip.status !== 'DRAFT') throw new BadRequestException('فقط فیش پیش‌نویس قابل ویرایش است');
    const taxSettings = await getPayrollTaxSettings(ctx.tenantDb);
    const { insuranceAmount, taxAmount } = computePayrollDeductions(slip.baseSalary + dto.allowances, taxSettings);
    return ctx.tenantDb.payrollSlip.update({
      where: { id },
      data: { allowances: dto.allowances, deductions: dto.deductions, insuranceAmount, taxAmount },
      include: { employee: employeeSelect },
    });
  }

  /** حذف فیش اشتباه — فقط پیش‌نویس؛ فیش صادرشده یا پرداخت‌شده سابقه‌ی مالی است و حذف نمی‌شود. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    const slip = await ctx.tenantDb.payrollSlip.findUnique({ where: { id } });
    if (!slip) throw new NotFoundException('فیش حقوقی یافت نشد');
    if (slip.status !== 'DRAFT') throw new BadRequestException('فقط فیش پیش‌نویس قابل حذف است');
    await ctx.tenantDb.payrollSlip.delete({ where: { id } });
    return { success: true };
  }

  @Post(':id/issue')
  async issue(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    const slip = await ctx.tenantDb.payrollSlip.findUnique({ where: { id } });
    if (!slip) throw new NotFoundException('فیش حقوقی یافت نشد');
    if (slip.status !== 'DRAFT') throw new BadRequestException('این فیش قبلاً صادر شده است');
    return ctx.tenantDb.payrollSlip.update({
      where: { id },
      data: { status: 'ISSUED', issuedAt: new Date() },
      include: { employee: employeeSelect },
    });
  }

  @Post(':id/pay')
  async pay(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    await this.permissions.assertViewAll(ctx, 'hr'); // رکوردهای مالی/پرسنلی مالک مشخص ندارند — فقط با «مشاهده‌ی همه»
    const slip = await ctx.tenantDb.payrollSlip.findUnique({ where: { id } });
    if (!slip) throw new NotFoundException('فیش حقوقی یافت نشد');
    if (slip.status !== 'ISSUED') throw new BadRequestException('ابتدا باید فیش صادر شود');
    return ctx.tenantDb.payrollSlip.update({
      where: { id },
      data: { status: 'PAID', paidAt: new Date() },
      include: { employee: employeeSelect },
    });
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertViewAll(ctx, 'hr');
    const slip = await ctx.tenantDb.payrollSlip.findUnique({
      where: { id },
      include: { employee: employeeSelect },
    });
    if (!slip) throw new NotFoundException('فیش حقوقی یافت نشد');

    const [settingsRows, tenant] = await Promise.all([
      ctx.tenantDb.moduleSetting.findMany({ where: { moduleCode: GENERAL_SETTINGS_MODULE } }),
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    ]);
    const byKey = Object.fromEntries(settingsRows.map((r) => [r.key, r.value as string]));

    const pdf = await this.pdf.render(slip, {
      orgName: tenant.name,
      economicCode: byKey.economicCode ?? null,
      nationalId: byKey.nationalId ?? null,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="payroll-${slip.periodYear}-${slip.periodMonth}-${slip.employee.employeeCode}.pdf"`);
    res.send(pdf);
  }
}
