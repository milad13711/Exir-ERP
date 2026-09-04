import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import type { CreateContractDto } from './dto/create-contract.dto.js';
import type { UpdateContractDto } from './dto/update-contract.dto.js';
import type { SaveContractTemplateDto } from './dto/save-contract-template.dto.js';
import type { SignContractDto } from './dto/sign-contract.dto.js';

const CONTRACT_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true } },
  employee: { select: { id: true, fullName: true, phone: true } },
  secondPartyContact: { select: { id: true, name: true, company: true, phone: true } },
  template: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

/** نام نمایشی طرف قرارداد — برای پیام‌های اتوماسیون/یادآوری، مستقل از اینکه کدام یک از فیلدهای طرف پر شده. */
export function contractPartyName(contract: {
  contact: { name: string } | null;
  employee: { fullName: string } | null;
}): string {
  return contract.contact?.name ?? contract.employee?.fullName ?? 'نامشخص';
}

export function contentHashOf(contract: { title: string; value: number; startDate: Date; endDate: Date; terms: string | null }): string {
  const canonical = JSON.stringify({
    title: contract.title,
    value: contract.value,
    startDate: contract.startDate.toISOString(),
    endDate: contract.endDate.toISOString(),
    terms: contract.terms ?? '',
  });
  return createHash('sha256').update(canonical).digest('hex');
}

@Injectable()
export class ContractsService {
  constructor(private readonly automation: AutomationEngineService) {}

  list(ctx: TenantRequestContext, filters: { type?: string; status?: string; contactId?: string; legalCategory?: string }) {
    return ctx.tenantDb.contract.findMany({
      where: {
        ...(filters.type ? { type: filters.type as never } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
        ...(filters.legalCategory ? { legalCategory: filters.legalCategory as never } : {}),
      },
      include: CONTRACT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** برای ویجت داشبورد — قراردادهایی که تا یک ماه آینده منقضی می‌شوند. */
  expiringSoon(ctx: TenantRequestContext) {
    return ctx.tenantDb.contract.findMany({
      where: { status: 'ACTIVE', endDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86_400_000) } },
      include: CONTRACT_INCLUDE,
      orderBy: { endDate: 'asc' },
      take: 20,
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const contract = await ctx.tenantDb.contract.findUnique({
      where: { id },
      include: { ...CONTRACT_INCLUDE, editRequests: { orderBy: { createdAt: 'desc' } }, amendments: { orderBy: { createdAt: 'desc' } } },
    });
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

  private validateParties(dto: { partyMode: string; contactId?: string; employeeId?: string; secondPartyContactId?: string; secondPartyName?: string; secondPartyPhone?: string }) {
    if (dto.partyMode === 'INTERNAL') {
      if (!dto.employeeId) throw new BadRequestException('برای قرارداد داخلی انتخاب پرسنل الزامی است');
    } else if (dto.partyMode === 'EXTERNAL') {
      if (!dto.contactId) throw new BadRequestException('برای قرارداد خارجی انتخاب مشتری/تأمین‌کننده الزامی است');
    } else {
      if (!dto.contactId) throw new BadRequestException('طرف اول قرارداد را انتخاب کنید');
      if (!dto.secondPartyContactId && !dto.secondPartyName) {
        throw new BadRequestException('طرف دوم قرارداد را انتخاب یا وارد کنید');
      }
      if (!dto.secondPartyContactId && !dto.secondPartyPhone) {
        throw new BadRequestException('شماره موبایل طرف دوم برای امضای دیجیتال الزامی است');
      }
    }
  }

  async create(ctx: TenantRequestContext, dto: CreateContractDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    this.validateDateRange(startDate, endDate);
    this.validateParties(dto);

    let terms = dto.terms;
    if (!terms && dto.templateId) {
      const template = await ctx.tenantDb.contractTemplate.findUnique({ where: { id: dto.templateId } });
      terms = template?.body;
    }

    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.contract.create({
      data: {
        title: dto.title,
        partyMode: dto.partyMode,
        type: dto.type,
        legalCategory: dto.legalCategory ?? 'GENERAL',
        templateId: dto.templateId,
        contactId: dto.partyMode === 'INTERNAL' ? undefined : dto.contactId,
        employeeId: dto.partyMode === 'INTERNAL' ? dto.employeeId : undefined,
        secondPartyContactId: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyContactId : undefined,
        secondPartyName: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyName : undefined,
        secondPartyPhone: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyPhone : undefined,
        value: dto.value,
        startDate,
        endDate,
        autoRenew: dto.autoRenew ?? false,
        renewalReminderDays: dto.renewalReminderDays ?? 30,
        terms,
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

  /** پس از تکمیل امضای هر دو طرف (یا طرف بیرونی + امضای داخلی شرکت)، قرارداد قفل و هش می‌شود. */
  async finalizeIfComplete(ctx: TenantRequestContext, id: string) {
    const contract = await ctx.tenantDb.contract.findUnique({ where: { id }, include: CONTRACT_INCLUDE });
    if (!contract) throw new NotFoundException('قرارداد یافت نشد');
    if (!contract.partyASignedAt || !contract.partyBSignedAt) return contract;
    if (contract.isLocked) return contract;

    const locked = await ctx.tenantDb.contract.update({
      where: { id },
      data: {
        isLocked: true,
        status: 'ACTIVE',
        signedAt: new Date(),
        contentHash: contentHashOf(contract),
      },
      include: CONTRACT_INCLUDE,
    });

    await this.automation.emit(ctx, 'contracts.contract.signed', {
      contractNo: locked.contractNo,
      title: locked.title,
      contactName: contractPartyName(locked),
      value: locked.value,
    });

    return locked;
  }

  /** امضای طرف «شرکت» توسط کاربر لاگین‌شده — فقط برای قراردادهای INTERNAL/EXTERNAL؛ برای THIRD_PARTY هر دو طرف باید از لینک عمومی امضا کنند. */
  async signAsCompany(ctx: TenantRequestContext, id: string, dto: SignContractDto) {
    const existing = await ctx.tenantDb.contract.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قرارداد یافت نشد');
    if (existing.partyMode === 'THIRD_PARTY') {
      throw new BadRequestException('این قرارداد بین دو طرف دیگر است — امضای شرکت در آن معنا ندارد');
    }
    if (existing.isLocked) throw new ConflictException('این قرارداد قبلاً به‌طور کامل امضا و قفل شده است');
    if (existing.partyBSignedAt) throw new ConflictException('امضای شرکت قبلاً ثبت شده است');

    await ctx.tenantDb.contract.update({
      where: { id },
      data: { partyBSignedAt: new Date(), partyBSignatureDataUrl: dto.signatureDataUrl, partyBSignerName: dto.signerName },
    });

    return this.finalizeIfComplete(ctx, id);
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
      contactName: contractPartyName(contract),
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

  // ── قالب‌های پیش‌فرض قرارداد ──────────────────────────────────────────

  listTemplates(ctx: TenantRequestContext) {
    return ctx.tenantDb.contractTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
  }

  async saveTemplate(ctx: TenantRequestContext, dto: SaveContractTemplateDto) {
    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.contractTemplate.create({
      data: { name: dto.name, partyMode: dto.partyMode, type: dto.type, body: dto.body, createdByUserId },
    });
  }

  async updateTemplate(ctx: TenantRequestContext, id: string, dto: SaveContractTemplateDto) {
    const existing = await ctx.tenantDb.contractTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قالب یافت نشد');
    return ctx.tenantDb.contractTemplate.update({
      where: { id },
      data: { name: dto.name, partyMode: dto.partyMode, type: dto.type, body: dto.body },
    });
  }

  async deleteTemplate(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.contractTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قالب یافت نشد');
    await ctx.tenantDb.contractTemplate.delete({ where: { id } });
  }

  // ── درخواست‌های ویرایش و الحاقیه‌ها ─────────────────────────────────────

  listEditRequests(ctx: TenantRequestContext, contractId: string) {
    return ctx.tenantDb.contractEditRequest.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } });
  }

  async resolveEditRequest(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.contractEditRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('درخواست یافت نشد');
    return ctx.tenantDb.contractEditRequest.update({ where: { id }, data: { resolved: true } });
  }

  listAmendments(ctx: TenantRequestContext, contractId: string) {
    return ctx.tenantDb.contractAmendment.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } });
  }

  async createAmendment(ctx: TenantRequestContext, contractId: string, text: string) {
    const contract = await ctx.tenantDb.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('قرارداد یافت نشد');
    if (!contract.isLocked) throw new BadRequestException('الحاقیه فقط برای قرارداد امضاشده معنا دارد — قرارداد پیش‌نویس را مستقیم ویرایش کنید');

    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.contractAmendment.create({ data: { contractId, text, createdByUserId } });
  }

  /** امضای الحاقیه از طرف «شرکت» — همان محدودیت INTERNAL/EXTERNAL که در امضای اصل قرارداد هست. */
  async signAmendmentAsCompany(ctx: TenantRequestContext, amendmentId: string, dto: SignContractDto) {
    const amendment = await ctx.tenantDb.contractAmendment.findUnique({ where: { id: amendmentId }, include: { contract: true } });
    if (!amendment) throw new NotFoundException('الحاقیه یافت نشد');
    if (amendment.contract.partyMode === 'THIRD_PARTY') {
      throw new BadRequestException('این قرارداد بین دو طرف دیگر است — امضای شرکت در آن معنا ندارد');
    }
    if (amendment.isLocked) throw new ConflictException('این الحاقیه قبلاً به‌طور کامل امضا شده است');
    if (amendment.partyBSignedAt) throw new ConflictException('امضای شرکت روی این الحاقیه قبلاً ثبت شده است');

    await ctx.tenantDb.contractAmendment.update({
      where: { id: amendmentId },
      data: { partyBSignedAt: new Date(), partyBSignatureDataUrl: dto.signatureDataUrl },
    });

    return this.finalizeAmendmentIfComplete(ctx, amendmentId);
  }

  async finalizeAmendmentIfComplete(ctx: TenantRequestContext, amendmentId: string) {
    const amendment = await ctx.tenantDb.contractAmendment.findUnique({ where: { id: amendmentId } });
    if (!amendment) throw new NotFoundException('الحاقیه یافت نشد');
    if (!amendment.partyASignedAt || !amendment.partyBSignedAt) return amendment;
    if (amendment.isLocked) return amendment;

    return ctx.tenantDb.contractAmendment.update({
      where: { id: amendmentId },
      data: {
        isLocked: true,
        contentHash: createHash('sha256').update(JSON.stringify({ contractId: amendment.contractId, text: amendment.text })).digest('hex'),
      },
    });
  }
}
