import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { getManagerUsers } from '../common/manager-users.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { ensureDefaultChartOfAccounts } from '../accounting/default-chart-of-accounts.js';
import type { CreateCheckDto } from './dto/create-check.dto.js';

const ACCOUNT = {
  RECEIVABLE: '1030',
  PAYABLE: '2010',
};

const CHECK_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true } },
  endorsedToContact: { select: { id: true, name: true, company: true } },
  invoice: { select: { id: true, invoiceNo: true } },
  purchaseOrder: { select: { id: true, orderNo: true } },
};

const CHECKS_SETTINGS_MODULE = 'checks';
const REMINDER_CHANNELS_KEY = 'reminderChannels';

export type ReminderChannels = { sms: boolean; notification: boolean };
const DEFAULT_REMINDER_CHANNELS: ReminderChannels = { sms: true, notification: true };

@Injectable()
export class ChecksService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly sms: ExirSmsService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationEngineService,
  ) {}

  list(
    ctx: TenantRequestContext,
    filters: { direction?: 'RECEIVED' | 'ISSUED'; status?: string; dueSoonDays?: number; contactId?: string },
  ) {
    const where: Record<string, unknown> = {};
    if (filters.direction) where.direction = filters.direction;
    if (filters.status) where.status = filters.status;
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.dueSoonDays != null) {
      where.status = { in: ['PENDING', 'DEPOSITED'] };
      where.dueDate = { lte: new Date(Date.now() + filters.dueSoonDays * 86_400_000) };
    }
    return ctx.tenantDb.check.findMany({ where, include: CHECK_INCLUDE, orderBy: { dueDate: 'asc' } });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const check = await ctx.tenantDb.check.findUnique({ where: { id }, include: CHECK_INCLUDE });
    if (!check) throw new NotFoundException('چک یافت نشد');
    return check;
  }

  async create(ctx: TenantRequestContext, dto: CreateCheckDto) {
    if (dto.direction === 'RECEIVED' && !dto.contactId) {
      throw new BadRequestException('برای چک دریافتی، انتخاب مشتری الزامی است');
    }
    if (dto.direction === 'ISSUED' && !dto.supplierId) {
      throw new BadRequestException('برای چک صادرشده، انتخاب تأمین‌کننده الزامی است');
    }
    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.check.create({
      data: {
        direction: dto.direction,
        sayadId: dto.sayadId,
        amount: dto.amount,
        dueDate: new Date(dto.dueDate),
        bankName: dto.bankName,
        contactId: dto.direction === 'RECEIVED' ? dto.contactId : dto.supplierId,
        reminderDaysBefore: dto.reminderDaysBefore ?? 3,
        note: dto.note,
        createdByUserId,
      },
      include: CHECK_INCLUDE,
    });
  }

  async markDeposited(ctx: TenantRequestContext, id: string) {
    const check = await ctx.tenantDb.check.findUnique({ where: { id } });
    if (!check) throw new NotFoundException('چک یافت نشد');
    if (check.status !== 'PENDING') throw new BadRequestException('فقط چک ثبت‌شده/صادرشده قابل واگذاری به بانک است');
    return ctx.tenantDb.check.update({
      where: { id },
      data: { status: 'DEPOSITED' },
      include: CHECK_INCLUDE,
    });
  }

  async markCleared(ctx: TenantRequestContext, id: string) {
    const check = await ctx.tenantDb.check.findUnique({ where: { id } });
    if (!check) throw new NotFoundException('چک یافت نشد');
    if (check.status !== 'PENDING' && check.status !== 'DEPOSITED') {
      throw new BadRequestException('فقط چک ثبت‌شده یا واگذارشده به بانک قابل تغییر است');
    }
    return ctx.tenantDb.check.update({
      where: { id },
      data: { status: 'CLEARED', clearedAt: new Date() },
      include: CHECK_INCLUDE,
    });
  }

  async markBounced(ctx: TenantRequestContext, id: string) {
    const check = await ctx.tenantDb.check.findUnique({ where: { id }, include: CHECK_INCLUDE });
    if (!check) throw new NotFoundException('چک یافت نشد');
    if (check.status !== 'PENDING' && check.status !== 'DEPOSITED') {
      throw new BadRequestException('فقط چک ثبت‌شده یا واگذارشده به بانک قابل تغییر است');
    }

    const updated = await ctx.tenantDb.check.update({ where: { id }, data: { status: 'BOUNCED' } });

    // چک برگشتی مشتری به‌طور خودکار روی سابقه‌ی اعتباری او ثبت می‌شود.
    if (updated.direction === 'RECEIVED' && updated.contactId) {
      await ctx.tenantDb.crmContact.update({
        where: { id: updated.contactId },
        data: { hasBouncedChecks: true },
      });
    }

    await this.alertManagersOfBounce(ctx, check);
    await this.automation.emit(ctx, 'checks.check.bounced', {
      sayadId: check.sayadId,
      amount: check.amount,
      contactName: check.contact?.name ?? null,
      direction: check.direction,
    });
    return ctx.tenantDb.check.findUniqueOrThrow({ where: { id }, include: CHECK_INCLUDE });
  }

  /**
   * A bounced check is urgent regardless of the tenant's regular reminder
   * channel toggles (that setting governs the routine due-date reminder,
   * not this) — every owner/admin gets an in-app+email notification AND a
   * forced SMS, since a bounce needs same-day attention.
   */
  private async alertManagersOfBounce(
    ctx: TenantRequestContext,
    check: { direction: 'RECEIVED' | 'ISSUED'; sayadId: string; amount: number; contact: { name: string } | null },
  ): Promise<void> {
    const managers = await getManagerUsers(this.controlDb, ctx.tenantDb, ctx.tenantId);
    if (managers.length === 0) return;

    const partyName = check.contact?.name;
    const title = `⚠ چک برگشتی — ${partyName ?? ''}`;
    const body = `چک ${check.direction === 'RECEIVED' ? 'دریافتی از' : 'صادرشده برای'} ${partyName ?? ''} به شماره صیادی ${check.sayadId} و مبلغ ${check.amount.toLocaleString('en-US')} تومان برگشت خورد.`;
    const smsMessage = `اکسیر ERP — هشدار فوری: ${body}`;

    for (const manager of managers) {
      await this.notifications.notify(ctx.tenantDb, {
        userId: manager.tenantUserId,
        type: 'check.bounced',
        title,
        body,
        link: '/checks',
      });
      if (this.sms.isConfigured()) {
        await this.sms.sendSms(manager.phone, smsMessage);
      }
    }
  }

  /**
   * پشت‌نویسی — به‌جای واگذاری چک دریافتی به بانک خودمان، آن را مستقیم به
   * شخص دیگری (معمولاً یک تأمین‌کننده‌ی طلبکار) واگذار می‌کنیم. هیچ نقدی
   * جابه‌جا نمی‌شود؛ فقط طلب طرف اول تسویه و بدهی طرف دوم کم می‌شود — یک سند
   * بدهکار حساب‌های پرداختنی/بستانکار حساب‌های دریافتنی، به همراه دو
   * PartyTransaction برای رهگیری در گردش حساب هر دو طرف.
   */
  async endorse(ctx: TenantRequestContext, id: string, toContactId: string) {
    const check = await ctx.tenantDb.check.findUnique({ where: { id } });
    if (!check) throw new NotFoundException('چک یافت نشد');
    if (check.direction !== 'RECEIVED') {
      throw new ForbiddenException('فقط چک دریافتی قابل پشت‌نویسی است');
    }
    if (check.status !== 'PENDING') {
      throw new BadRequestException('فقط چک ثبت‌شده (پیش از واگذاری به بانک) قابل پشت‌نویسی است');
    }
    if (!check.contactId) {
      throw new BadRequestException('این چک طرف‌حساب مشخصی ندارد');
    }
    if (toContactId === check.contactId) {
      throw new BadRequestException('طرف واگذاری نمی‌تواند همان طرف‌حساب اصلی چک باشد');
    }
    await ctx.tenantDb.crmContact.findUniqueOrThrow({ where: { id: toContactId } });
    await ensureDefaultChartOfAccounts(ctx.tenantDb);

    const userId = await resolveTenantUserId(ctx);
    const receivable = await this.getAccount(ctx, ACCOUNT.RECEIVABLE);
    const payable = await this.getAccount(ctx, ACCOUNT.PAYABLE);

    const [entry] = await ctx.tenantDb.$transaction([
      ctx.tenantDb.journalEntry.create({
        data: {
          date: new Date(),
          description: `پشت‌نویسی چک به شماره صیادی ${check.sayadId}`,
          status: 'POSTED',
          postedAt: new Date(),
          createdByUserId: userId,
          lines: {
            create: [
              { accountId: payable.id, debit: BigInt(check.amount), credit: BigInt(0) },
              { accountId: receivable.id, debit: BigInt(0), credit: BigInt(check.amount) },
            ],
          },
        },
      }),
      ctx.tenantDb.check.update({
        where: { id },
        data: { status: 'ENDORSED', endorsedToContactId: toContactId, endorsedAt: new Date() },
      }),
    ]);

    await ctx.tenantDb.partyTransaction.createMany({
      data: [
        {
          partyId: check.contactId,
          type: 'RECEIPT',
          amount: check.amount,
          accountCode: ACCOUNT.RECEIVABLE,
          note: `تسویه با پشت‌نویسی چک به شماره صیادی ${check.sayadId}`,
          journalEntryId: entry.id,
          createdByUserId: userId,
        },
        {
          partyId: toContactId,
          type: 'PAYMENT',
          amount: check.amount,
          accountCode: ACCOUNT.PAYABLE,
          note: `پرداخت با پشت‌نویسی چک دریافتی به شماره صیادی ${check.sayadId}`,
          journalEntryId: entry.id,
          createdByUserId: userId,
        },
      ],
    });

    return ctx.tenantDb.check.findUniqueOrThrow({ where: { id }, include: CHECK_INCLUDE });
  }

  private async getAccount(ctx: TenantRequestContext, code: string) {
    const account = await ctx.tenantDb.account.findUnique({ where: { code } });
    if (!account) throw new BadRequestException(`کدینگ حسابداری ${code} یافت نشد — ابتدا از بخش حسابداری بازدید کنید`);
    return account;
  }

  async cancel(ctx: TenantRequestContext, id: string) {
    const check = await ctx.tenantDb.check.findUnique({ where: { id } });
    if (!check) throw new NotFoundException('چک یافت نشد');
    if (check.status !== 'PENDING' && check.status !== 'DEPOSITED') {
      throw new BadRequestException('فقط چک ثبت‌شده یا واگذارشده به بانک قابل لغو است');
    }
    return ctx.tenantDb.check.update({ where: { id }, data: { status: 'CANCELLED' }, include: CHECK_INCLUDE });
  }

  async updateReminderDays(ctx: TenantRequestContext, id: string, days: number) {
    await ctx.tenantDb.check.findUniqueOrThrow({ where: { id } });
    return ctx.tenantDb.check.update({
      where: { id },
      data: { reminderDaysBefore: days },
      include: CHECK_INCLUDE,
    });
  }

  async getReminderChannels(tenantDb: TenantPrismaClient): Promise<ReminderChannels> {
    const row = await tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: CHECKS_SETTINGS_MODULE, key: REMINDER_CHANNELS_KEY } },
    });
    if (!row) return DEFAULT_REMINDER_CHANNELS;
    const value = row.value as Partial<ReminderChannels>;
    return { sms: value.sms ?? true, notification: value.notification ?? true };
  }

  async setReminderChannels(ctx: TenantRequestContext, channels: ReminderChannels): Promise<void> {
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: CHECKS_SETTINGS_MODULE, key: REMINDER_CHANNELS_KEY } },
      create: { moduleCode: CHECKS_SETTINGS_MODULE, key: REMINDER_CHANNELS_KEY, value: channels },
      update: { value: channels },
    });
  }
}
