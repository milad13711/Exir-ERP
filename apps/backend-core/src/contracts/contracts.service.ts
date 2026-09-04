import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreateContractDto } from './dto/create-contract.dto.js';
import type { UpdateContractDto } from './dto/update-contract.dto.js';

const CONTRACT_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ContractsService {
  constructor(private readonly automation: AutomationEngineService) {}

  list(ctx: TenantRequestContext, filters: { type?: string; status?: string; contactId?: string }) {
    return ctx.tenantDb.contract.findMany({
      where: {
        ...(filters.type ? { type: filters.type as never } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
      },
      include: CONTRACT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const contract = await ctx.tenantDb.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
    if (!contract) throw new NotFoundException('قرارداد یافت نشد');
    return contract;
  }

  private validateDateRange(startDate: Date, endDate: Date) {
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('تاریخ شروع یا پایان نامعتبر است');
    }
    if (endDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException('تاریخ پایان باید بعد از تاریخ شروع باشد');
    }
  }

  async create(ctx: TenantRequestContext, dto: CreateContractDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    this.validateDateRange(startDate, endDate);

    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.contract.create({
      data: {
        title: dto.title,
        type: dto.type,
        contactId: dto.contactId,
        value: dto.value,
        startDate,
        endDate,
        autoRenew: dto.autoRenew ?? false,
        renewalReminderDays: dto.renewalReminderDays ?? 30,
        terms: dto.terms,
        createdByUserId,
      },
      include: CONTRACT_INCLUDE,
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateContractDto) {
    const existing = await ctx.tenantDb.contract.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قرارداد یافت نشد');
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('فقط قرارداد در وضعیت پیش‌نویس قابل ویرایش است');
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (dto.startDate || dto.endDate) this.validateDateRange(startDate, endDate);

    return ctx.tenantDb.contract.update({
      where: { id },
      data: {
        title: dto.title,
        contactId: dto.contactId,
        value: dto.value,
        startDate,
        endDate,
        autoRenew: dto.autoRenew,
        renewalReminderDays: dto.renewalReminderDays,
        terms: dto.terms,
      },
      include: CONTRACT_INCLUDE,
    });
  }

  async sign(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
    if (!existing) throw new NotFoundException('قرارداد یافت نشد');
    if (existing.status !== 'DRAFT') {
      throw new ConflictException('فقط قرارداد در وضعیت پیش‌نویس قابل امضا است');
    }

    const contract = await ctx.tenantDb.contract.update({
      where: { id },
      data: { status: 'ACTIVE', signedAt: new Date() },
      include: CONTRACT_INCLUDE,
    });

    await this.automation.emit(ctx, 'contracts.contract.signed', {
      contractNo: contract.contractNo,
      title: contract.title,
      contactName: contract.contact.name,
      value: contract.value,
    });

    return contract;
  }

  async terminate(ctx: TenantRequestContext, id: string, reason: string | undefined) {
    const existing = await ctx.tenantDb.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
    if (!existing) throw new NotFoundException('قرارداد یافت نشد');
    if (existing.status !== 'ACTIVE') {
      throw new ConflictException('فقط قرارداد فعال قابل فسخ است');
    }

    const contract = await ctx.tenantDb.contract.update({
      where: { id },
      data: { status: 'TERMINATED', terminatedAt: new Date(), terminationReason: reason },
      include: CONTRACT_INCLUDE,
    });

    await this.automation.emit(ctx, 'contracts.contract.terminated', {
      contractNo: contract.contractNo,
      title: contract.title,
      contactName: contract.contact.name,
      reason: reason ?? null,
    });

    return contract;
  }

  async renew(ctx: TenantRequestContext, id: string, newEndDate: string) {
    const existing = await ctx.tenantDb.contract.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قرارداد یافت نشد');
    if (existing.status !== 'ACTIVE' && existing.status !== 'EXPIRED') {
      throw new ConflictException('فقط قرارداد فعال یا منقضی‌شده قابل تمدید است');
    }

    const endDate = new Date(newEndDate);
    if (Number.isNaN(endDate.getTime()) || endDate.getTime() <= existing.endDate.getTime()) {
      throw new BadRequestException('تاریخ پایان جدید باید بعد از تاریخ پایان فعلی باشد');
    }

    return ctx.tenantDb.contract.update({
      where: { id },
      data: { endDate, status: 'ACTIVE', reminderSentAt: null },
      include: CONTRACT_INCLUDE,
    });
  }
}
