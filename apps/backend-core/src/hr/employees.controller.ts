import {
  Body,
  ConflictException,
  Controller,
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
import { PermissionsService } from '../permissions/permissions.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { buildExcelBuffer, parseExcelBuffer, summarize, type ImportRowResult } from '../common/excel.js';
import { ImportExcelDto } from '../common/dto/import-excel.dto.js';
import { CreateEmployeeDto } from './dto/create-employee.dto.js';
import { UpdateEmployeeDto } from './dto/update-employee.dto.js';
import { AssignManagerDto } from './dto/assign-manager.dto.js';
import { CreateEmployeeDocumentDto } from './dto/create-employee-document.dto.js';

const EMPLOYEE_EXCEL_HEADERS = ['کد پرسنلی', 'نام کامل', 'سمت', 'واحد', 'تلفن', 'ایمیل', 'تاریخ استخدام', 'حقوق پایه'];

@Controller('hr/employees')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('hr')
export class EmployeesController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly automation: AutomationEngineService,
  ) {}

  @Get()
  async list(
    @Query('q') q: string | undefined,
    @Query('includeTerminated') includeTerminated: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertView(ctx, 'hr');
    return ctx.tenantDb.employee.findMany({
      where: {
        ...(includeTerminated === 'true' ? {} : { status: 'ACTIVE' }),
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { employeeCode: { contains: q, mode: 'insensitive' } },
                { position: { contains: q, mode: 'insensitive' } },
                { department: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Every employee, flat, with just enough to build the org chart client-side. */
  @Get('org-chart')
  async orgChart(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'hr');
    return ctx.tenantDb.employee.findMany({
      select: { id: true, fullName: true, position: true, department: true, managerId: true, status: true },
      orderBy: { fullName: 'asc' },
    });
  }

  @Get('export')
  async export(@Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertView(ctx, 'hr');
    const employees = await ctx.tenantDb.employee.findMany({ where: { status: 'ACTIVE' }, orderBy: { fullName: 'asc' } });
    const buffer = await buildExcelBuffer(
      EMPLOYEE_EXCEL_HEADERS,
      employees.map((e) => ({
        'کد پرسنلی': e.employeeCode,
        'نام کامل': e.fullName,
        سمت: e.position,
        واحد: e.department ?? '',
        تلفن: e.phone ?? '',
        ایمیل: e.email ?? '',
        'تاریخ استخدام': e.hireDate.toISOString().slice(0, 10),
        'حقوق پایه': e.baseSalary,
      })),
      'کارمندان',
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.xlsx"');
    res.send(buffer);
  }

  /**
   * Upserts by کد پرسنلی: an existing code updates that employee, a new one
   * creates it. Rows missing کد پرسنلی, نام کامل or سمت are skipped rather
   * than failing the whole import.
   */
  @Post('import')
  async import(@Body() dto: ImportExcelDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    const buffer = Buffer.from(dto.fileBase64, 'base64');
    const rows = await parseExcelBuffer(buffer);

    const results: ImportRowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2;
      const employeeCode = String(row['کد پرسنلی'] ?? '').trim();
      const fullName = String(row['نام کامل'] ?? '').trim();
      const position = String(row['سمت'] ?? '').trim();
      if (!employeeCode || !fullName || !position) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'کد پرسنلی، نام کامل یا سمت خالی است' });
        continue;
      }

      const hireDateRaw = String(row['تاریخ استخدام'] ?? '').trim();
      const hireDate = hireDateRaw ? new Date(hireDateRaw) : new Date();
      if (Number.isNaN(hireDate.getTime())) {
        results.push({ row: rowNumber, status: 'SKIPPED', reason: 'تاریخ استخدام نامعتبر است' });
        continue;
      }

      const data = {
        fullName,
        position,
        department: String(row['واحد'] ?? '').trim() || undefined,
        phone: String(row['تلفن'] ?? '').trim() || undefined,
        email: String(row['ایمیل'] ?? '').trim() || undefined,
        hireDate,
        baseSalary: Number(row['حقوق پایه'] ?? 0) || 0,
      };

      const existing = await ctx.tenantDb.employee.findUnique({ where: { employeeCode } });
      if (existing) {
        await ctx.tenantDb.employee.update({ where: { id: existing.id }, data });
        results.push({ row: rowNumber, status: 'UPDATED' });
      } else {
        await ctx.tenantDb.employee.create({ data: { employeeCode, ...data } });
        results.push({ row: rowNumber, status: 'CREATED' });
      }
    }

    return summarize(results);
  }

  @Post()
  async create(@Body() dto: CreateEmployeeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'hr');
    const existing = await ctx.tenantDb.employee.findUnique({ where: { employeeCode: dto.employeeCode } });
    if (existing) throw new ConflictException('کارمندی با این کد پرسنلی از قبل وجود دارد');
    return ctx.tenantDb.employee.create({
      data: {
        employeeCode: dto.employeeCode,
        fullName: dto.fullName,
        position: dto.position,
        department: dto.department,
        nationalId: dto.nationalId,
        phone: dto.phone,
        email: dto.email,
        hireDate: new Date(dto.hireDate),
        baseSalary: dto.baseSalary ?? 0,
        managerId: dto.managerId,
        userId: dto.userId,
      },
    });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'hr');
    const employee = await ctx.tenantDb.employee.findUnique({
      where: { id },
      include: {
        attendance: { orderBy: { date: 'desc' }, take: 30 },
        leaveRequests: { orderBy: { createdAt: 'desc' } },
        payrollSlips: { orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }] },
        documents: { orderBy: { uploadedAt: 'desc' } },
        manager: { select: { id: true, fullName: true, position: true } },
        directReports: { select: { id: true, fullName: true, position: true } },
      },
    });
    if (!employee) throw new NotFoundException('کارمند یافت نشد');
    return employee;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    const existing = await ctx.tenantDb.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('کارمند یافت نشد');
    if (dto.employeeCode && dto.employeeCode !== existing.employeeCode) {
      const codeTaken = await ctx.tenantDb.employee.findUnique({ where: { employeeCode: dto.employeeCode } });
      if (codeTaken) throw new ConflictException('کارمندی با این کد پرسنلی از قبل وجود دارد');
    }
    return ctx.tenantDb.employee.update({
      where: { id },
      data: {
        employeeCode: dto.employeeCode,
        fullName: dto.fullName,
        position: dto.position,
        department: dto.department,
        nationalId: dto.nationalId,
        phone: dto.phone,
        email: dto.email,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        baseSalary: dto.baseSalary,
      },
    });
  }

  /**
   * Soft-delete only — Attendance/LeaveRequest/PayrollSlip/EmployeeDocument
   * all Cascade off Employee, so a hard DELETE would silently wipe that
   * history. Flips `status` to TERMINATED (excluded from the default list)
   * instead, same pattern as Product.isActive.
   */
  @Post(':id/terminate')
  async terminate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'hr');
    const existing = await ctx.tenantDb.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('کارمند یافت نشد');
    const updated = await ctx.tenantDb.employee.update({ where: { id }, data: { status: 'TERMINATED' } });
    await this.automation.emit(ctx, 'hr.employee.terminated', {
      employeeName: updated.fullName,
      employeeCode: updated.employeeCode,
      position: updated.position,
    });
    return updated;
  }

  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    const existing = await ctx.tenantDb.employee.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('کارمند یافت نشد');
    return ctx.tenantDb.employee.update({ where: { id }, data: { status: 'ACTIVE' } });
  }

  @Post(':id/manager')
  async assignManager(@Param('id') id: string, @Body() dto: AssignManagerDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'hr');
    await ctx.tenantDb.employee.findUniqueOrThrow({ where: { id } });
    if (dto.managerId === id) {
      throw new ConflictException('یک کارمند نمی‌تواند مدیر بالادستی خودش باشد');
    }
    return ctx.tenantDb.employee.update({
      where: { id },
      data: { managerId: dto.managerId ?? null },
      include: { manager: { select: { id: true, fullName: true } } },
    });
  }

  @Post(':id/documents')
  async addDocument(
    @Param('id') id: string,
    @Body() dto: CreateEmployeeDocumentDto,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertEdit(ctx, 'hr');
    await ctx.tenantDb.employee.findUniqueOrThrow({ where: { id } });
    return ctx.tenantDb.employeeDocument.create({
      data: {
        employeeId: id,
        type: dto.type,
        title: dto.title,
        fileUrl: dto.fileUrl,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }
}
