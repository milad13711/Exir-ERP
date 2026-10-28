import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantSmsService, smsParts } from '../sms/tenant-sms.service.js';
import { tehranDateKey } from '../notifications/push-logic.js';
import {
  HR_SMS_DECISION_LABELS,
  HR_SMS_PER_PERSON_DAILY_CAP,
  HR_REQUEST_TYPE_LABELS,
  hrSmsClaimKey,
  maskPhone,
  mergeHrSmsSettings,
  normalizeIranMobile,
  renderHrSms,
  validateHrSmsSettingsInput,
  type HrRequestSmsSettings,
  type HrRequestType,
  type HrSmsEvent,
} from './request-sms.js';

const SETTINGS = { moduleCode: 'hr', key: 'requestSms' } as const;

export type HrSmsNoticeInput = {
  type: HrRequestType;
  requestId: string;
  event: HrSmsEvent;
  employee: { id: string; fullName: string; phone?: string | null; userId?: string | null };
  /** تاریخ‌ها از پیش فارسی‌شده‌اند (مثلاً faDate) */
  fromDate?: string;
  toDate?: string;
  approverName?: string | null;
  /** دلیل رد؛ در پیامک کوتاه می‌شود */
  note?: string | null;
};

export type HrSmsNoticeResult = { status: 'DISABLED' | 'DUPLICATE' | 'SENT' | 'FAILED' | 'SKIPPED'; reason?: string };

@Injectable()
export class HrRequestSmsService {
  private readonly logger = new Logger('HrRequestSmsService');

  constructor(
    private readonly sms: TenantSmsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async getSettings(db: TenantPrismaClient): Promise<HrRequestSmsSettings> {
    const row = await db.moduleSetting.findUnique({ where: { moduleCode_key: SETTINGS } });
    return mergeHrSmsSettings(row?.value);
  }

  async setSettings(db: TenantPrismaClient, input: Partial<HrRequestSmsSettings>): Promise<{ settings?: HrRequestSmsSettings; error?: string }> {
    const error = validateHrSmsSettingsInput(input);
    if (error) return { error };
    const cur = await this.getSettings(db);
    const merged = mergeHrSmsSettings({
      ...cur,
      ...input,
      events: { ...cur.events, ...input.events },
      types: { ...cur.types, ...input.types },
      templates: { ...cur.templates, ...input.templates },
    });
    await db.moduleSetting.upsert({
      where: { moduleCode_key: SETTINGS },
      create: { ...SETTINGS, value: merged as unknown as object },
      update: { value: merged as unknown as object },
    });
    return { settings: merged };
  }

  async listLog(db: TenantPrismaClient, type: string, requestId: string) {
    return db.hrRequestSmsLog.findMany({
      where: { requestType: type, requestId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, event: true, status: true, reason: true, maskedPhone: true, parts: true, createdAt: true },
    });
  }

  /** هرگز پرتاب نمی‌کند — شکست پیامک نباید تأیید/رد درخواست را مختل کند. */
  async notify(ctx: { tenantId?: string; tenantDb: TenantPrismaClient }, input: HrSmsNoticeInput): Promise<HrSmsNoticeResult> {
    try {
      return await this.notifyInner(ctx, input);
    } catch (err) {
      this.logger.warn(`HR request SMS failed (${input.type}/${input.requestId}/${input.event}): ${err instanceof Error ? err.message : err}`);
      return { status: 'FAILED', reason: 'internal_error' };
    }
  }

  private async notifyInner(ctx: { tenantId?: string; tenantDb: TenantPrismaClient }, input: HrSmsNoticeInput): Promise<HrSmsNoticeResult> {
    const db = ctx.tenantDb;
    const settings = await this.getSettings(db);
    if (!settings.enabled || !settings.types[input.type] || !settings.events[input.event]) return { status: 'DISABLED' };

    // claim اتمیک (یکتا): تلاش دوباره/ارسال همزمان هرگز پیامک دوم نمی‌سازد
    const claimKey = hrSmsClaimKey(input.type, input.requestId, input.event);
    let logId: string;
    try {
      const row = await db.hrRequestSmsLog.create({
        data: { requestType: input.type, requestId: input.requestId, event: input.event, requesterEmployeeId: input.employee.id, status: 'PENDING', claimKey },
      });
      logId = row.id;
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') return { status: 'DUPLICATE' };
      throw err;
    }
    const finish = async (status: 'SENT' | 'FAILED' | 'SKIPPED', reason?: string, extra: { maskedPhone?: string; parts?: number } = {}): Promise<HrSmsNoticeResult> => {
      await db.hrRequestSmsLog
        .update({ where: { id: logId }, data: { status, reason: reason?.slice(0, 200), ...extra } })
        .catch((e) => this.logger.warn(`HR SMS log update failed: ${e instanceof Error ? e.message : e}`));
      return { status, reason };
    };

    // شماره: ابتدا شماره‌ی پرونده‌ی پرسنلی، سپس کاربر متصل
    let phone = normalizeIranMobile(input.employee.phone);
    if (!phone && input.employee.userId) {
      const u = await db.user.findUnique({ where: { id: input.employee.userId }, select: { phone: true } });
      phone = normalizeIranMobile(u?.phone);
    }
    if (!phone) return finish('SKIPPED', 'شماره‌ی موبایل معتبر برای درخواست‌کننده ثبت نشده است');

    // سقف‌ها (محافظ هزینه): کل تننت در روز + هر نفر در روز. ردیف claim همین پیامک شمرده نمی‌شود (id: not) و مقایسه >= است:
    // با سقف N دقیقاً N پیامک مجاز است و پیامک (N+1)ام رد می‌شود.
    const dayStart = new Date(`${tehranDateKey(new Date())}T00:00:00+03:30`);
    const [tenantToday, personToday] = await Promise.all([
      db.hrRequestSmsLog.count({ where: { id: { not: logId }, createdAt: { gte: dayStart }, status: { in: ['SENT', 'PENDING'] } } }),
      db.hrRequestSmsLog.count({ where: { id: { not: logId }, requesterEmployeeId: input.employee.id, createdAt: { gte: dayStart }, status: { in: ['SENT', 'PENDING'] } } }),
    ]);
    if (tenantToday >= settings.dailyCap) return finish('SKIPPED', `سقف روزانه‌ی ${settings.dailyCap} پیامک پر شده است`);
    if (personToday >= HR_SMS_PER_PERSON_DAILY_CAP) return finish('SKIPPED', 'سقف روزانه‌ی پیامک این فرد پر شده است');

    const orgName = ctx.tenantId
      ? await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }).then((t) => t?.name ?? '', () => '')
      : '';
    const text = renderHrSms(settings.templates[input.event], {
      employeeName: input.employee.fullName,
      requestType: HR_REQUEST_TYPE_LABELS[input.type],
      decision: HR_SMS_DECISION_LABELS[input.event],
      fromDate: input.fromDate,
      toDate: input.toDate,
      approverName: input.approverName,
      note: input.event === 'REJECTED' ? input.note : '',
      orgName,
    });
    if (!text) return finish('SKIPPED', 'قالب پیامک خالی است');

    const result = await this.sms.sendSms({ tenantId: ctx.tenantId, tenantDb: db }, phone, text, { purpose: `hr-request-${input.event.toLowerCase()}`, moduleCode: 'hr', actorType: 'SYSTEM' });
    return finish(result.success ? 'SENT' : 'FAILED', result.success ? undefined : String(result.error ?? 'ارسال ناموفق'), { maskedPhone: maskPhone(phone), parts: smsParts(text) });
  }
}
