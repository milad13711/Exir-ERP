import { ApprovalsService } from '../approvals/approvals.service.js';
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { CompanyStampService } from '../settings/company-stamp.service.js';
import { formatJalaliDate } from '../common/persian.js';
import type { CreateContractDto } from './dto/create-contract.dto.js';
import type { UpdateContractDto } from './dto/update-contract.dto.js';
import type { SaveContractTemplateDto } from './dto/save-contract-template.dto.js';
import type { SignContractDto } from './dto/sign-contract.dto.js';
import type { AddWitnessDto } from './dto/add-witness.dto.js';
import { normalizeSearchTerm, searchTermAsInt } from '../common/search.js';

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

/** نام نمایشی طرف دوم — فقط برای THIRD_PARTY پر است؛ در غیر این صورت «شرکت» (طرف داخلی/خارجی همیشه ما هستیم). */
export function contractSecondPartyName(contract: {
  partyMode: string;
  secondPartyContact: { name: string } | null;
  secondPartyName: string | null;
}): string {
  if (contract.partyMode !== 'THIRD_PARTY') return 'شرکت';
  return contract.secondPartyContact?.name ?? contract.secondPartyName ?? 'نامشخص';
}

type PartyInfo = { name: string; phone: string; nationalId: string; registrationNumber: string; address: string };
const EMPTY_PARTY: PartyInfo = { name: '', phone: '', nationalId: '', registrationNumber: '', address: '' };

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
export class ContractsService implements OnModuleInit {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly controlDb: ControlPrismaService,
    private readonly stamp: CompanyStampService,
    private readonly approvals: ApprovalsService,
  ) {}

  onModuleInit(): void {
    // امضای طرف «شرکت» روی قرارداد داخلی/خارجی با تأیید مدیر و درج امضای رسمی شرکت.
    this.approvals.registerHandler('CONTRACT', {
      approve: async (ctx, id, opts) => {
        if (!opts.stampApplied) {
          throw new BadRequestException('برای امضای قرارداد باید «تأیید و اجازه‌ی درج مهر و امضا» را بزنید');
        }
        const { signatureImage } = await this.stamp.getStamp(ctx);
        if (!signatureImage) throw new BadRequestException('امضای شرکت در تنظیمات عمومی ثبت نشده است');
        const userId = await resolveTenantUserId(ctx).catch(() => undefined);
        const user = userId ? await ctx.tenantDb.user.findUnique({ where: { id: userId } }) : null;
        await this.signAsCompany(ctx, id, { signatureDataUrl: signatureImage, signerName: user?.name ?? 'مدیر' }, true);
      },
      reject: async () => undefined,
      describe: async (ctx, id) => {
        const c = await ctx.tenantDb.contract.findUniqueOrThrow({ where: { id } });
        return {
          fields: [
            { label: 'عنوان', value: c.title },
            { label: 'شماره', value: String(c.contractNo) },
            { label: 'نوع طرفین', value: c.partyMode },
            { label: 'مبلغ', value: `${Number(c.value ?? 0).toLocaleString('en-US')} تومان` },
            { label: 'شروع تا پایان', value: `${c.startDate.toLocaleDateString('fa-IR')} تا ${c.endDate.toLocaleDateString('fa-IR')}` },
            { label: 'متن قرارداد', value: c.terms ?? '—' },
          ],
        };
      },
    });
  }

  list(ctx: TenantRequestContext, filters: { type?: string; status?: string; contactId?: string; legalCategory?: string; category?: string; q?: string }, scope: Record<string, unknown> = {}) {
    const term = normalizeSearchTerm(filters.q);
    const no = term ? searchTermAsInt(term) : undefined;
    return ctx.tenantDb.contract.findMany({
      where: {
        ...scope,
        ...(term
          ? {
              OR: [
                ...(no !== undefined ? [{ contractNo: no }] : []),
                { title: { contains: term, mode: 'insensitive' as const } },
                { secondPartyName: { contains: term, mode: 'insensitive' as const } },
                { contact: { name: { contains: term, mode: 'insensitive' as const } } },
                { contact: { company: { contains: term, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
        ...(filters.type ? { type: filters.type as never } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
        ...(filters.contactId ? { contactId: filters.contactId } : {}),
        ...(filters.legalCategory ? { legalCategory: filters.legalCategory as never } : {}),
        ...(filters.category ? { category: filters.category } : {}),
      },
      include: CONTRACT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** فهرست دسته‌بندی‌های متمایزی که تاکنون برای فیلتر استفاده شده‌اند. */
  async listCategories(ctx: TenantRequestContext) {
    const rows = await ctx.tenantDb.contract.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ['category'],
    });
    return rows.map((r) => r.category).filter((c): c is string => !!c);
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

  async detail(ctx: TenantRequestContext, id: string, scope: Record<string, unknown> = {}) {
    const contract = await ctx.tenantDb.contract.findFirst({
      where: { id, ...scope },
      include: {
        ...CONTRACT_INCLUDE,
        editRequests: { orderBy: { createdAt: 'desc' } },
        amendments: { orderBy: { createdAt: 'desc' } },
        witnesses: { orderBy: { createdAt: 'desc' } },
      },
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

  /**
   * جایگزینی فیلدهای متن قالب — نام‌های ساده‌ی فارسی برای هر دو طرف، به‌همراه
   * هر فیلد سفارشی‌ای که کاربر هنگام ثبت قرارداد وارد کرده. کلید ناشناخته
   * دست‌نخورده باقی می‌ماند (match ?? ...) تا یک {{تایپو}} کل سند را خراب نکند.
   */
  private fillTemplatePlaceholders(
    body: string,
    values: {
      companyName: string;
      partyA: PartyInfo;
      partyB: PartyInfo;
      startDate: Date;
      endDate: Date;
      value: number;
      title?: string;
      customFields?: Record<string, string>;
    },
  ): string {
    const map: Record<string, string> = {
      'شرکت': values.companyName,
      'نام_شرکت': values.companyName,
      'طرف_دوم': values.partyB.name,
      'طرف_مقابل': values.partyB.name,
      'نام_طرف_اول': values.partyA.name,
      'نام_طرف_دوم': values.partyB.name,
      'شماره_تماس_طرف_اول': values.partyA.phone,
      'شماره_تماس_طرف_دوم': values.partyB.phone,
      'شماره_ملی_طرف_اول': values.partyA.nationalId,
      'شماره_ملی_طرف_دوم': values.partyB.nationalId,
      'شماره_ثبت_طرف_اول': values.partyA.registrationNumber,
      'شماره_ثبت_طرف_دوم': values.partyB.registrationNumber,
      'آدرس_طرف_اول': values.partyA.address,
      'آدرس_طرف_دوم': values.partyB.address,
      'تاریخ_شروع': formatJalaliDate(values.startDate),
      'تاریخ_پایان': formatJalaliDate(values.endDate),
      'ارزش_قرارداد': values.value.toLocaleString('fa-IR'),
      'مبلغ_قرارداد': values.value.toLocaleString('fa-IR'),
      'عنوان_قرارداد': values.title ?? '',
      'تاریخ_امروز': formatJalaliDate(new Date()),
      ...values.customFields,
    };
    return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, key: string) => map[key.trim()] ?? match);
  }

  /**
   * اطلاعات کامل طرف قرارداد برای جایگزینی در قالب. طرف اول همیشه مخاطب/
   * پرسنل است؛ طرف دوم برای INTERNAL/EXTERNAL خودِ شرکت است (مطابق همان
   * قرارداد contractSecondPartyName)، و برای THIRD_PARTY یا مخاطب CRM یا
   * فیلدهای آزادی است که کاربر مستقیم وارد کرده.
   */
  private async resolveParties(
    ctx: TenantRequestContext,
    dto: {
      partyMode: string;
      contactId?: string;
      employeeId?: string;
      secondPartyContactId?: string;
      secondPartyName?: string;
      secondPartyPhone?: string;
      secondPartyNationalId?: string;
      secondPartyRegistrationNumber?: string;
      secondPartyAddress?: string;
    },
    companyInfo: PartyInfo,
  ): Promise<{ partyA: PartyInfo; partyB: PartyInfo }> {
    let partyA: PartyInfo = EMPTY_PARTY;
    if (dto.partyMode === 'INTERNAL' && dto.employeeId) {
      const employee = await ctx.tenantDb.employee.findUnique({
        where: { id: dto.employeeId },
        select: { fullName: true, phone: true, nationalId: true },
      });
      if (employee) {
        partyA = { name: employee.fullName, phone: employee.phone ?? '', nationalId: employee.nationalId ?? '', registrationNumber: '', address: '' };
      }
    } else if (dto.contactId) {
      const contact = await ctx.tenantDb.crmContact.findUnique({
        where: { id: dto.contactId },
        select: { name: true, phone: true, nationalId: true, registrationNumber: true, address: true },
      });
      if (contact) {
        partyA = {
          name: contact.name,
          phone: contact.phone ?? '',
          nationalId: contact.nationalId ?? '',
          registrationNumber: contact.registrationNumber ?? '',
          address: contact.address ?? '',
        };
      }
    }

    let partyB: PartyInfo = companyInfo;
    if (dto.partyMode === 'THIRD_PARTY') {
      if (dto.secondPartyContactId) {
        const contact = await ctx.tenantDb.crmContact.findUnique({
          where: { id: dto.secondPartyContactId },
          select: { name: true, phone: true, nationalId: true, registrationNumber: true, address: true },
        });
        partyB = contact
          ? {
              name: contact.name,
              phone: contact.phone ?? '',
              nationalId: contact.nationalId ?? '',
              registrationNumber: contact.registrationNumber ?? '',
              address: contact.address ?? '',
            }
          : EMPTY_PARTY;
      } else {
        partyB = {
          name: dto.secondPartyName ?? '',
          phone: dto.secondPartyPhone ?? '',
          nationalId: dto.secondPartyNationalId ?? '',
          registrationNumber: dto.secondPartyRegistrationNumber ?? '',
          address: dto.secondPartyAddress ?? '',
        };
      }
    }

    return { partyA, partyB };
  }

  /** اطلاعات ثبتی خودِ شرکت — از تنظیمات عمومی (Settings → General)، همان منبعی که برای هدر فاکتور/سند رسمی استفاده می‌شود. */
  private async resolveCompanyInfo(ctx: TenantRequestContext, companyName: string): Promise<PartyInfo> {
    const rows = await ctx.tenantDb.moduleSetting.findMany({
      where: { moduleCode: 'general', key: { in: ['nationalId', 'registrationNumber', 'address', 'phone'] } },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value as string | undefined]));
    return {
      name: companyName,
      phone: byKey.phone ?? '',
      nationalId: byKey.nationalId ?? '',
      registrationNumber: byKey.registrationNumber ?? '',
      address: byKey.address ?? '',
    };
  }

  async create(ctx: TenantRequestContext, dto: CreateContractDto) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    this.validateDateRange(startDate, endDate);
    this.validateParties(dto);

    const tenant = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
    const companyName = tenant?.name ?? '';

    let terms = dto.terms;
    let guaranteeTerms = dto.guaranteeTerms;
    if (!terms && dto.templateId) {
      const template = await ctx.tenantDb.contractTemplate.findUnique({ where: { id: dto.templateId } });
      terms = template?.body ?? undefined;
    }
    // فیلدهای پویا ({{نام_طرف_اول}} و…) در متن بندها و ضمانت اجرا — چه از قالب آمده باشند چه مستقیم تایپ شده باشند
    if ((terms && terms.includes('{{')) || (guaranteeTerms && guaranteeTerms.includes('{{'))) {
      const companyInfo = await this.resolveCompanyInfo(ctx, companyName);
      const { partyA, partyB } = await this.resolveParties(ctx, dto, companyInfo);
      const fill = (text: string) =>
        this.fillTemplatePlaceholders(text, {
          companyName,
          partyA,
          partyB,
          startDate,
          endDate,
          value: dto.value,
          title: dto.title,
          customFields: dto.customFields,
        });
      if (terms) terms = fill(terms);
      if (guaranteeTerms) guaranteeTerms = fill(guaranteeTerms);
    }

    const createdByUserId = await resolveTenantUserId(ctx);
    const created = await ctx.tenantDb.contract.create({
      data: {
        title: dto.title,
        partyMode: dto.partyMode,
        type: dto.type,
        legalCategory: dto.legalCategory ?? 'GENERAL',
        category: dto.category,
        guaranteeTerms,
        referredSignerUserId: dto.referredSignerUserId,
        templateId: dto.templateId,
        contactId: dto.partyMode === 'INTERNAL' ? undefined : dto.contactId,
        employeeId: dto.partyMode === 'INTERNAL' ? dto.employeeId : undefined,
        secondPartyContactId: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyContactId : undefined,
        secondPartyName: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyName : undefined,
        secondPartyPhone: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyPhone : undefined,
        secondPartyNationalId: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyNationalId : undefined,
        secondPartyRegistrationNumber: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyRegistrationNumber : undefined,
        secondPartyAddress: dto.partyMode === 'THIRD_PARTY' ? dto.secondPartyAddress : undefined,
        customFieldValues: dto.customFields ?? undefined,
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
    if (created.partyMode !== 'THIRD_PARTY') {
      await this.approvals.request(ctx, {
        moduleCode: 'contracts',
        entityType: 'CONTRACT',
        entityId: created.id,
        title: `امضای قرارداد «${created.title}»`,
        summary: 'امضای طرف شرکت (مهر و امضای رسمی) در انتظار مدیر است.',
        link: '/contracts',
        isOfficial: true,
        requestedByUserId: createdByUserId ?? undefined,
      });
    }
    return created;
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

    let terms = dto.terms;
    let guaranteeTerms = dto.guaranteeTerms;
    if ((terms && terms.includes('{{')) || (guaranteeTerms && guaranteeTerms.includes('{{'))) {
      const tenant = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } });
      const companyName = tenant?.name ?? '';
      const companyInfo = await this.resolveCompanyInfo(ctx, companyName);
      const { partyA, partyB } = await this.resolveParties(
        ctx,
        {
          partyMode: existing.partyMode,
          contactId: dto.contactId ?? existing.contactId ?? undefined,
          employeeId: existing.employeeId ?? undefined,
          secondPartyContactId: existing.secondPartyContactId ?? undefined,
          secondPartyName: existing.secondPartyName ?? undefined,
          secondPartyPhone: existing.secondPartyPhone ?? undefined,
          secondPartyNationalId: existing.secondPartyNationalId ?? undefined,
          secondPartyRegistrationNumber: existing.secondPartyRegistrationNumber ?? undefined,
          secondPartyAddress: existing.secondPartyAddress ?? undefined,
        },
        companyInfo,
      );
      const fill = (text: string) =>
        this.fillTemplatePlaceholders(text, {
          companyName,
          partyA,
          partyB,
          startDate,
          endDate,
          value: dto.value ?? existing.value,
          title: dto.title ?? existing.title,
          customFields: (existing.customFieldValues as Record<string, string> | null) ?? undefined,
        });
      if (terms) terms = fill(terms);
      if (guaranteeTerms) guaranteeTerms = fill(guaranteeTerms);
    }

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
        terms,
        category: dto.category,
        guaranteeTerms,
        referredSignerUserId: dto.referredSignerUserId,
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

  /**
   * امضای طرف «شرکت» توسط کاربر لاگین‌شده — فقط برای قراردادهای INTERNAL/
   * EXTERNAL؛ برای THIRD_PARTY هر دو طرف باید از لینک عمومی امضا کنند.
   * دسترسی به مهر/امضای رسمی فقط مالک تننت است، مگر مالک آن را برای یک
   * کاربر خاص ارجاع داده باشد (CompanyStampService، تنظیمات سراسری) یا
   * برای همین قرارداد به‌طور خاص یک امضاکننده تعیین کرده باشد
   * (referredSignerUserId، تنظیم قدیمی‌تر و مخصوص همین یک قرارداد).
   */
  private async assertCanSignAsCompany(ctx: TenantRequestContext, referredSignerUserId: string | null) {
    if (ctx.auth.role === 'OWNER') return;
    if (referredSignerUserId) {
      const userId = await resolveTenantUserId(ctx);
      if (userId && userId === referredSignerUserId) return;
    }
    await this.stamp.assertCanUse(ctx);
  }

  async signAsCompany(ctx: TenantRequestContext, id: string, dto: SignContractDto, fromApprovals = false) {
    const existing = await ctx.tenantDb.contract.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('قرارداد یافت نشد');
    if (existing.partyMode === 'THIRD_PARTY') {
      throw new BadRequestException('این قرارداد بین دو طرف دیگر است — امضای شرکت در آن معنا ندارد');
    }
    await this.assertCanSignAsCompany(ctx, existing.referredSignerUserId);
    if (existing.isLocked) throw new ConflictException('این قرارداد قبلاً به‌طور کامل امضا و قفل شده است');
    if (existing.partyBSignedAt) throw new ConflictException('امضای شرکت قبلاً ثبت شده است');

    await ctx.tenantDb.contract.update({
      where: { id },
      data: {
        partyBSignedAt: new Date(),
        partyBSignatureDataUrl: dto.signatureDataUrl,
        partyBSignerName: dto.signerName,
        partyBSignedAsDelegate: this.stamp.isActingAsDelegate(ctx),
      },
    });

    if (!fromApprovals) await this.approvals.closeForEntity(ctx, 'CONTRACT', id, 'APPROVED', true);
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
    await this.assertCanSignAsCompany(ctx, amendment.contract.referredSignerUserId);
    if (amendment.isLocked) throw new ConflictException('این الحاقیه قبلاً به‌طور کامل امضا شده است');
    if (amendment.partyBSignedAt) throw new ConflictException('امضای شرکت روی این الحاقیه قبلاً ثبت شده است');

    await ctx.tenantDb.contractAmendment.update({
      where: { id: amendmentId },
      data: {
        partyBSignedAt: new Date(),
        partyBSignatureDataUrl: dto.signatureDataUrl,
        partyBSignedAsDelegate: this.stamp.isActingAsDelegate(ctx),
      },
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

  // ── شاهدها ────────────────────────────────────────────────────────────

  listWitnesses(ctx: TenantRequestContext, contractId: string) {
    return ctx.tenantDb.contractWitness.findMany({ where: { contractId }, orderBy: { createdAt: 'desc' } });
  }

  async addWitness(ctx: TenantRequestContext, contractId: string, dto: AddWitnessDto) {
    const contract = await ctx.tenantDb.contract.findUnique({ where: { id: contractId } });
    if (!contract) throw new NotFoundException('قرارداد یافت نشد');
    if (contract.isLocked) throw new BadRequestException('این قرارداد قبلاً قفل شده — امکان افزودن شاهد جدید نیست');
    return ctx.tenantDb.contractWitness.create({ data: { contractId, name: dto.name, phone: dto.phone } });
  }

  async removeWitness(ctx: TenantRequestContext, witnessId: string) {
    const witness = await ctx.tenantDb.contractWitness.findUnique({ where: { id: witnessId } });
    if (!witness) throw new NotFoundException('شاهد یافت نشد');
    if (witness.signedAt) throw new ConflictException('شاهدی که امضا کرده را نمی‌توان حذف کرد');
    await ctx.tenantDb.contractWitness.delete({ where: { id: witnessId } });
  }

  /** مهر/امضای رسمی شرکت — حالا فقط از منبع مرکزی (Settings → General)؛ این ماژول دیگر نسخه‌ی جدا و بارگذاری‌شدنی خودش را ندارد. */
  getCompanySignature(ctx: TenantRequestContext) {
    return this.stamp.getStamp(ctx);
  }
}
