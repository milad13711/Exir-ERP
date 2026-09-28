import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { publicRef } from '../common/tenant-public-key.js';
import { SchedulableJobRegistryService, offsetPreset } from '../scheduling/schedulable-job-registry.service.js';

const FIRST_SURVEY_AFTER_DAYS = 7;
const REPEAT_EVERY_DAYS = 30;

/**
 * هر روز روی تمام تننت‌های دارای ماژول رفرال/نمایندگی اجرا می‌شود: به هر
 * مشتری معرفی‌شده (ReferralConversion) که مدتی از معرفی یا آخرین
 * نظرسنجی‌اش گذشته، یک لینک نظرسنجی رضایت از پشتیبانی نماینده‌ی معرف
 * پیامک می‌کند. عمومی است — هم برای تننت‌های معمولی روی مشتریان واقعی
 * خودشان کار می‌کند، هم برای تننت رجیستری پلتفرم (eta) روی صاحبان
 * تننت‌های معرفی‌شده، چون هر دو یک CrmContact با شماره تماس دارند.
 */
@Injectable()
export class ReferralNpsSurveyService implements OnModuleInit {
  private readonly logger = new Logger('ReferralNpsSurveyService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: ExirSmsService,
    private readonly jobRegistry: SchedulableJobRegistryService,
  ) {}

  /** فقط ثبت در فهرست «زمان‌بندی ارسال خودکار» — بازه‌ی واقعی از FIRST_SURVEY_AFTER_DAYS/REPEAT_EVERY_DAYS ثابت این فایل می‌آید. */
  onModuleInit(): void {
    this.jobRegistry.registerJob({
      code: 'referral-nps-survey',
      label: 'نظرسنجی رضایت پس از معرفی (NPS)',
      moduleCode: 'referral-marketing',
      defaultConfig: offsetPreset(FIRST_SURVEY_AFTER_DAYS, 'DAYS_AFTER', 9, 0),
      allowedOffsets: [
        offsetPreset(FIRST_SURVEY_AFTER_DAYS, 'DAYS_AFTER', 9, 0),
        offsetPreset(REPEAT_EVERY_DAYS, 'DAYS_AFTER', 9, 0),
      ],
      behaviorWired: false,
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sweep(): Promise<void> {
    if (!this.sms.isConfigured()) return;
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const installed = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'referral-marketing' } },
      });
      if (!installed) continue;
      try {
        await this.sweepTenant(tenant);
      } catch (err) {
        this.logger.error(`Referral NPS survey sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async sweepTenant(tenant: { dbHost: string; dbPort: number; dbName: string; slug: string }): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant(tenant);
    const now = new Date();
    const firstSurveyCutoff = new Date(now.getTime() - FIRST_SURVEY_AFTER_DAYS * 86_400_000);
    const repeatCutoff = new Date(now.getTime() - REPEAT_EVERY_DAYS * 86_400_000);

    const conversions = await tenantDb.referralConversion.findMany({
      where: {
        contact: { phone: { not: null } },
        createdAt: { lte: firstSurveyCutoff },
      },
      include: {
        contact: { select: { phone: true } },
        resellerProfile: { select: { contact: { select: { name: true } } } },
        npsSurveys: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    if (!publicWebUrl) return;

    for (const conversion of conversions) {
      const lastSurvey = conversion.npsSurveys[0];
      if (lastSurvey && lastSurvey.createdAt > repeatCutoff) continue; // هنوز زمان نظرسنجی بعدی نرسیده

      const survey = await tenantDb.referralNpsSurvey.create({ data: { referralConversionId: conversion.id } });
      const url = `${publicWebUrl}/referral-survey/${publicRef(tenant.slug)}/${survey.publicToken}`;
      const resellerName = conversion.resellerProfile.contact.name;
      const result = await this.sms.sendSms(
        conversion.contact.phone!,
        `نظر شما درباره‌ی کیفیت پشتیبانی «${resellerName}» به ما کمک می‌کند: ${url}`,
      );
      if (result.success) {
        await tenantDb.referralNpsSurvey.update({ where: { id: survey.id }, data: { sentAt: new Date() } });
      }
    }
  }
}
