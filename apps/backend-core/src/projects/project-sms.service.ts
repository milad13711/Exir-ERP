import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantSmsService, smsParts } from '../sms/tenant-sms.service.js';
import { RateLimitStore } from '../security/rate-limit.js';
import { maskPhone } from '../security/mask.js';
import { publicRef } from '../common/tenant-public-key.js';
import { computeProjectProgress } from './project-progress.js';
import {
  EVENT_LABELS,
  EVENT_LOG_CODE,
  MAX_TEMPLATE_LENGTH,
  SAMPLE_VARS,
  mergeStoredSettings,
  parseSettingsInput,
  renderProjectSms,
  type ProjectSmsSettings,
  type SmsEventKey,
} from './project-sms.template.js';

const SETTING_KEY = { moduleCode: 'projects', key: 'sms' } as const;

export const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MANUAL_LIMIT_PER_HOUR = 10;
export const MAX_MANUAL_MESSAGE_LENGTH = 500;

export type SmsOutcome =
  | 'SENT'
  | 'FAILED'
  | 'SKIP_MASTER_OFF'
  | 'SKIP_EVENT_OFF'
  | 'SKIP_PROJECT_OFF'
  | 'SKIP_NO_CONTACT'
  | 'SKIP_NO_PHONE'
  | 'SKIP_DUPLICATE'
  | 'SKIP_PROJECT_CAP'
  | 'SKIP_TENANT_CAP'
  | 'SKIP_NO_PROJECT';

/** فقط موبایل ایران (۰۹xxxxxxxxx، +98، 0098)؛ ارقام فارسی هم پذیرفته می‌شود. */
export function isMobilePhone(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const digits = raw
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\s\-()+]/g, '');
  return /^(?:0098|98|0)?9\d{9}$/.test(digits);
}

/**
 * لینک مشتری برای {link}: فقط وقتی لینک عمومیِ همین پروژه «روشن» است آدرس مستقیم پروژه؛ وگرنه خالی.
 * (صفحه‌ی پیگیری /track فقط پروژه‌های دارای لینک عمومی روشن را نشان می‌دهد، پس برای پروژه‌ی خاموش بی‌معناست؛
 * توکن پروژه‌ی غیرفعال هرگز در پیامک نمی‌آید.)
 */
export function selectProjectLink(
  project: { publicEnabled: boolean; publicToken: string },
  publicWebUrl: string,
  tenantSlug: string,
): string {
  const base = (publicWebUrl ?? '').replace(/\/$/, '');
  if (!base || !project.publicEnabled || !project.publicToken) return '';
  return `${base}/project/${publicRef(tenantSlug)}/${project.publicToken}`;
}

/** پیام نهایی که کاربر ویرایش کرده: متن ساده؛ بدون HTML/کنترل، فاصله‌ها فشرده، حداکثر طول. */
export function sanitizeManualMessage(input: unknown): string {
  if (typeof input !== 'string') throw new BadRequestException('متن پیام نامعتبر است');
  const s = input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, '')
    .replace(/<[^>]*>?/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!s) throw new BadRequestException('متن پیام خالی است');
  if (s.length > MAX_MANUAL_MESSAGE_LENGTH) throw new BadRequestException(`متن پیام حداکثر ${MAX_MANUAL_MESSAGE_LENGTH} نویسه است`);
  return s;
}

type Loaded = {
  project: { id: string; name: string; status: string; publicEnabled: boolean; publicToken: string; notifyCustomerBySms: boolean | null };
  contact: { id: string; name: string; phone: string | null } | null;
  vars: Record<'name' | 'project' | 'stage' | 'percent' | 'done' | 'total' | 'link' | 'company' | 'phone', string | number>;
};

@Injectable()
export class ProjectSmsService {
  private readonly logger = new Logger('ProjectSmsService');
  private readonly manualLimiter = new RateLimitStore(10_000);

  constructor(
    private readonly sms: TenantSmsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  // ── تنظیمات ─────────────────────────────────────────────────────────

  async getSettings(ctx: TenantRequestContext): Promise<ProjectSmsSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: SETTING_KEY } });
    return mergeStoredSettings(row?.value);
  }

  async setSettings(ctx: TenantRequestContext, input: unknown): Promise<ProjectSmsSettings> {
    const next = parseSettingsInput(input, await this.getSettings(ctx));
    const value = next as unknown as object;
    await ctx.tenantDb.moduleSetting.upsert({ where: { moduleCode_key: SETTING_KEY }, update: { value }, create: { ...SETTING_KEY, value } });
    return next;
  }

  /** پیش‌نمایش زنده‌ی قالب با داده‌ی نمونه (بدون ذخیره و بدون هیچ داده‌ی واقعی). */
  previewTemplate(template: unknown, withLink = true) {
    if (typeof template !== 'string') throw new BadRequestException('قالب نامعتبر است');
    if (template.length > MAX_TEMPLATE_LENGTH * 2) throw new BadRequestException('قالب بیش از حد طولانی است');
    const message = renderProjectSms(template, { ...SAMPLE_VARS, link: withLink ? SAMPLE_VARS.link : '' });
    return { message, length: message.length, parts: smsParts(message) };
  }

  // ── بارگذاری داده‌ی پروژه (فقط فیلدهای فهرست سفید) ──────────────────

  private async load(ctx: TenantRequestContext, projectId: string, stageId?: string): Promise<Loaded | null> {
    const project = await ctx.tenantDb.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, status: true, contactId: true, publicEnabled: true, publicToken: true, notifyCustomerBySms: true },
    });
    if (!project) return null;
    const [contact, stages, phoneRow, tenant] = await Promise.all([
      project.contactId ? ctx.tenantDb.crmContact.findUnique({ where: { id: project.contactId }, select: { id: true, name: true, phone: true } }) : Promise.resolve(null),
      ctx.tenantDb.projectStage.findMany({ where: { projectId }, select: { id: true, title: true, status: true } }),
      ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'phone' } } }),
      this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }).catch(() => null),
    ]);
    const pr = computeProjectProgress(stages);
    const stage = stageId ? stages.find((s) => s.id === stageId) : undefined;
    const companyPhone = typeof phoneRow?.value === 'string' ? phoneRow.value : '';
    return {
      project,
      contact,
      vars: {
        name: contact?.name ?? '',
        project: project.name,
        stage: stage?.title ?? '',
        percent: pr.progressPercent,
        done: pr.doneStages,
        total: pr.totalStages,
        link: selectProjectLink(project, (process.env.WEB_PANEL_PUBLIC_URL ?? ''), ctx.tenantSlug),
        company: tenant?.name ?? '',
        phone: companyPhone,
      },
    };
  }

  // ── ارسال خودکار (بعد از کامیت تغییر وضعیت؛ هرگز پرتاب نمی‌کند) ─────

  async notifyEvent(ctx: TenantRequestContext, projectId: string, event: SmsEventKey, stageId?: string): Promise<SmsOutcome> {
    try {
      return await this.notifyEventUnsafe(ctx, projectId, event, stageId);
    } catch (e) {
      this.logger.warn(`Project SMS (${event}) failed for ${projectId}: ${(e as Error)?.message ?? e}`);
      await this.recordNote(ctx, projectId, stageId ?? null, null, `ارسال پیامک خودکار (${EVENT_LABELS[event]}) ناموفق بود`).catch(() => undefined);
      return 'FAILED';
    }
  }

  private async notifyEventUnsafe(ctx: TenantRequestContext, projectId: string, event: SmsEventKey, stageId?: string): Promise<SmsOutcome> {
    const settings = await this.getSettings(ctx);
    if (!settings.enabled) return 'SKIP_MASTER_OFF';
    const ev = settings.events[event];
    if (!ev.enabled) return 'SKIP_EVENT_OFF';

    const loaded = await this.load(ctx, projectId, stageId);
    if (!loaded) return 'SKIP_NO_PROJECT';
    if (loaded.project.notifyCustomerBySms === false) return 'SKIP_PROJECT_OFF';
    if (!loaded.contact) return 'SKIP_NO_CONTACT';
    if (!isMobilePhone(loaded.contact.phone)) return 'SKIP_NO_PHONE';

    const code = EVENT_LOG_CODE[event];
    const now = Date.now();

    // حذف تکراری: همان (پروژه، مرحله، رویداد) در ۱۰ دقیقه‌ی اخیر
    const recent = await ctx.tenantDb.projectSmsLog.findFirst({
      where: { projectId, stageId: stageId ?? null, event: code, mode: 'AUTO', createdAt: { gt: new Date(now - DEDUPE_WINDOW_MS) } },
      select: { id: true },
    });
    if (recent) return 'SKIP_DUPLICATE';

    // سقف روزانه (۲۴ ساعت گذشته): هر پروژه و کل تننت — ارسال‌های ناموفق هم شمرده می‌شوند
    const since = new Date(now - DAY_MS);
    const [projectCount, tenantCount] = await Promise.all([
      ctx.tenantDb.projectSmsLog.count({ where: { projectId, mode: 'AUTO', createdAt: { gt: since } } }),
      ctx.tenantDb.projectSmsLog.count({ where: { mode: 'AUTO', createdAt: { gt: since } } }),
    ]);
    if (projectCount >= settings.maxPerProjectPerDay) {
      this.logger.warn(`Project SMS skipped (per-project daily cap ${settings.maxPerProjectPerDay}) project=${projectId} event=${code}`);
      return 'SKIP_PROJECT_CAP';
    }
    if (tenantCount >= settings.maxPerTenantPerDay) {
      this.logger.warn(`Project SMS skipped (tenant daily cap ${settings.maxPerTenantPerDay}) event=${code}`);
      return 'SKIP_TENANT_CAP';
    }

    // رزرو اتمیک با کلید یکتا؛ دو فراخوانی هم‌زمان فقط یکی برنده می‌شود
    const dedupeKey = `${projectId}:${stageId ?? '-'}:${code}:${Math.floor(now / DEDUPE_WINDOW_MS)}`;
    let logId: string;
    try {
      const row = await ctx.tenantDb.projectSmsLog.create({
        data: { projectId, stageId: stageId ?? null, event: code, mode: 'AUTO', status: 'FAILED', error: 'در حال ارسال', dedupeKey },
        select: { id: true },
      });
      logId = row.id;
    } catch {
      return 'SKIP_DUPLICATE';
    }

    const message = renderProjectSms(ev.template, loaded.vars);
    const result = await this.sms.sendSms(ctx, loaded.contact.phone as string, message, { purpose: 'پیامک وضعیت پروژه', moduleCode: 'projects', actorType: 'AUTOMATIC' });
    await ctx.tenantDb.projectSmsLog.update({ where: { id: logId }, data: { status: result.success ? 'SENT' : 'FAILED', error: result.success ? null : (result.error ?? 'خطا').slice(0, 300) } });
    await this.recordNote(
      ctx,
      projectId,
      stageId ?? null,
      null,
      result.success ? `پیامک وضعیت ارسال شد (${EVENT_LABELS[event]}) به ${maskPhone(loaded.contact.phone as string)}` : `ارسال پیامک وضعیت ناموفق بود (${EVENT_LABELS[event]}): ${(result.error ?? '').slice(0, 120)}`,
    );
    return result.success ? 'SENT' : 'FAILED';
  }

  private async recordNote(ctx: TenantRequestContext, projectId: string, stageId: string | null, userId: string | null, body: string) {
    await ctx.tenantDb.projectNote.create({ data: { projectId, stageId, source: 'SMS', authorUserId: userId, body, visibleToCustomer: false } });
  }

  /** سوئیچ اختصاصی پروژه: true/false، یا null = پیروی از پیش‌فرض ماژول. */
  async setProjectNotify(ctx: TenantRequestContext, projectId: string, enabled: boolean | null) {
    const res = await ctx.tenantDb.project.updateMany({ where: { id: projectId }, data: { notifyCustomerBySms: enabled } });
    if (res.count === 0) throw new NotFoundException('پروژه یافت نشد');
    return { id: projectId, notifyCustomerBySms: enabled };
  }

  // ── ارسال دستی ──────────────────────────────────────────────────────

  /** پیش‌نمایش پیام دستی: قالب «ارسال وضعیت پروژه» با داده‌ی واقعی پروژه (دامنه‌ی دسترسی را کنترلر بررسی کرده). */
  async manualPreview(ctx: TenantRequestContext, projectId: string) {
    const loaded = await this.load(ctx, projectId);
    if (!loaded) throw new NotFoundException('پروژه یافت نشد');
    const settings = await this.getSettings(ctx);
    const message = renderProjectSms(settings.manualTemplate, loaded.vars);
    const phone = loaded.contact?.phone ?? null;
    return {
      contactName: loaded.contact?.name ?? null,
      phoneMasked: phone ? maskPhone(phone) : null,
      canSend: !!loaded.contact && isMobilePhone(phone),
      hasLink: loaded.vars.link !== '',
      message,
      length: message.length,
      parts: smsParts(message),
    };
  }

  async manualSend(ctx: TenantRequestContext, projectId: string, rawMessage: unknown) {
    const message = sanitizeManualMessage(rawMessage);
    const userId = await resolveTenantUserId(ctx);
    const limiterKey = `${ctx.tenantId}:${userId ?? ctx.auth.sub}`;
    if (!this.manualLimiter.hit(limiterKey, MANUAL_LIMIT_PER_HOUR, 3600).allowed) {
      throw new HttpException('تعداد ارسال پیامک وضعیت در یک ساعت بیش از حد مجاز است؛ بعداً تلاش کنید', HttpStatus.TOO_MANY_REQUESTS);
    }
    const loaded = await this.load(ctx, projectId);
    if (!loaded) throw new NotFoundException('پروژه یافت نشد');
    // گیرنده همیشه شماره‌ی مخاطبِ خودِ پروژه است؛ هرگز شماره‌ای از ورودی درخواست
    if (!loaded.contact) throw new BadRequestException('برای این پروژه مشتری انتخاب نشده است');
    const phone = loaded.contact.phone;
    if (!isMobilePhone(phone)) throw new BadRequestException('مشتری شماره‌ی موبایل معتبر ندارد');

    const result = await this.sms.sendSms(ctx, phone as string, message, { purpose: 'پیامک وضعیت پروژه (دستی)', moduleCode: 'projects' });
    await ctx.tenantDb.projectSmsLog.create({
      data: { projectId, event: 'MANUAL', mode: 'MANUAL', status: result.success ? 'SENT' : 'FAILED', error: result.success ? null : (result.error ?? 'خطا').slice(0, 300), userId },
    });
    if (!result.success) throw new BadRequestException(result.error ?? 'ارسال پیامک ناموفق بود');

    await this.recordNote(ctx, projectId, null, userId, `پیامک وضعیت ارسال شد به ${maskPhone(phone as string)}`).catch(() => undefined);
    if (loaded.contact.id) {
      await ctx.tenantDb.crmActivity
        .create({ data: { type: 'NOTE', body: `پیامک وضعیت پروژه «${loaded.project.name}» ارسال شد`, contactId: loaded.contact.id, userId: userId ?? undefined } })
        .catch(() => undefined);
    }
    return { ok: true, parts: smsParts(message) };
  }
}
