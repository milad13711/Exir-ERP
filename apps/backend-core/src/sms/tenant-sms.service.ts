import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService, type SendSmsResult } from './exir-sms.service.js';

/** هر چیزی که tenantId و tenantDb دارد — TenantRequestContext یا متغیرهای کرون‌ها. */
export type SmsTenant = { tenantId?: string; tenantDb: TenantPrismaClient };

export type SmsConnection =
  | { mode: 'NONE' }
  | { mode: 'SYSTEM'; tenantId?: string }
  | { mode: 'LEGACY' } // تننت قبل از این قابلیت: هنوز رایگان از پنل اصلی، تا پنل خودش را انتخاب کند
  | { mode: 'OWN'; apiKey: string; senderNumber: string };

const SETTING_KEY = { moduleCode: 'sms-panel', key: 'connection' } as const;

/** تعداد بخش‌های پیامک: فارسی (یونیکد) ۷۰ نویسه‌ی اول، سپس ۶۷ نویسه در هر بخش؛ لاتین ۱۶۰/۱۵۳. */
export function smsParts(message: string): number {
  const unicode = /[^\x00-\x7F]/.test(message);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  if (message.length <= single) return 1;
  return Math.ceil(message.length / multi);
}

/**
 * پیامک‌های ماژول‌های تننت (مصاحبه، نوبت، فاکتور فروش، یادآورها و ...) از «پنل پیامکی خودِ تننت»
 * ارسال می‌شود: یا پنل اختصاصی او (apiKey + شماره‌ی اختصاصی)، یا پنل مشترک اکسیر با اعتبار بسته‌ی
 * خریداری‌شده. پنل سیستمی بدون بسته یا اتصال، هرگز برای پیامک ماژول‌ها استفاده نمی‌شود؛ فقط
 * پیامک‌های خودِ پلتفرم (OTP، فاکتور/تمدید ماژول) مستقیم از ExirSmsService.sendSms می‌روند.
 */
@Injectable()
export class TenantSmsService {
  private readonly logger = new Logger('TenantSmsService');

  constructor(
    private readonly gateway: ExirSmsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async getConnection(tenantDb: TenantPrismaClient): Promise<SmsConnection> {
    const row = await tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SETTING_KEY } });
    const v = row?.value as { mode?: string; apiKey?: string; senderNumber?: string } | undefined;
    if (v?.mode === 'OWN' && v.apiKey && v.senderNumber) return { mode: 'OWN', apiKey: v.apiKey, senderNumber: v.senderNumber };
    if (v?.mode === 'LEGACY') return { mode: 'LEGACY' };
    if (v?.mode === 'SYSTEM') return { mode: 'SYSTEM', tenantId: (v as { tenantId?: string }).tenantId };
    return { mode: 'NONE' };
  }

  async setConnection(tenantDb: TenantPrismaClient, conn: SmsConnection): Promise<void> {
    const value = conn as unknown as object;
    await tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: SETTING_KEY },
      create: { ...SETTING_KEY, value },
      update: { value },
    });
  }

  async getWalletCredits(tenantId: string): Promise<number> {
    const wallet = await this.controlDb.tenantSmsWallet.findUnique({ where: { tenantId } });
    return wallet?.credits ?? 0;
  }

  async sendSms(tenant: SmsTenant, phone: string, message: string): Promise<SendSmsResult> {
    const conn = await this.getConnection(tenant.tenantDb);

    if (conn.mode === 'OWN') {
      return this.gateway.sendWith({ apiKey: conn.apiKey, sender: conn.senderNumber }, phone, message, { tenantId: tenant.tenantId, source: 'TENANT_OWN' });
    }

    if (conn.mode === 'SYSTEM') {
      const tenantId = tenant.tenantId ?? conn.tenantId;
      if (!tenantId) return { success: false, error: 'شناسه‌ی تننت برای کسر اعتبار پیامک مشخص نیست' };
      const parts = smsParts(message);
      // کسر اتمیک: اگر اعتبار کافی نباشد هیچ‌چیز کم نمی‌شود و ارسال انجام نمی‌شود.
      const debited = await this.controlDb.tenantSmsWallet.updateMany({
        where: { tenantId, credits: { gte: parts } },
        data: { credits: { decrement: parts } },
      });
      if (debited.count === 0) {
        return { success: false, error: 'اعتبار بسته‌ی پیامکی شما تمام شده است؛ از تنظیمات ← پنل پیامکی شارژ کنید' };
      }
      const result = await this.gateway.sendSms(phone, message, { tenantId, source: 'TENANT_SYSTEM' });
      if (!result.success) {
        await this.controlDb.tenantSmsWallet.update({ where: { tenantId }, data: { credits: { increment: parts } } });
      }
      return result;
    }

    if (conn.mode === 'LEGACY') return this.gateway.sendSms(phone, message, { tenantId: tenant.tenantId, source: 'TENANT_LEGACY' });

    this.logger.warn(`Tenant ${tenant.tenantId ?? '?'}: SMS skipped — no SMS panel connected`);
    return { success: false, error: 'پنل پیامکی متصل نیست؛ از تنظیمات ← پنل پیامکی آن را متصل کنید' };
  }
}
