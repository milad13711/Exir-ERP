import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { SchedulableJobRegistryService } from './schedulable-job-registry.service.js';
import type { JobScheduleConfig, ScheduleOffsetUnit } from './schedule-match.util.js';

const MODULE_CODE = 'scheduling';

const FALLBACK_CONFIG: JobScheduleConfig = { offsetDays: 0, unit: 'SAME_DAY', hour: 9, minute: 0 };

function isValidUnit(value: unknown): value is ScheduleOffsetUnit {
  return value === 'DAYS_BEFORE' || value === 'SAME_DAY' || value === 'DAYS_AFTER';
}

/**
 * Reads/writes the tenant's chosen JobScheduleConfig override for each
 * SchedulableJobRegistryService entry, using the same generic ModuleSetting
 * key-value store every other module's settings ride on (moduleCode
 * 'scheduling', key = the job's code) — see GeneralSettingsController for
 * the exact pattern this mirrors.
 */
@Injectable()
export class SchedulingService {
  constructor(private readonly registry: SchedulableJobRegistryService) {}

  /** Merged config (tenant override, falling back to the job's own default) — safe to call for a tenantDb the caller already has open, no ctx/role check needed for a read. */
  async getConfig(tenantDb: TenantRequestContext['tenantDb'], code: string): Promise<JobScheduleConfig> {
    const fallback = this.registry.getDefinition(code)?.defaultConfig ?? FALLBACK_CONFIG;
    const row = await tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: MODULE_CODE, key: code } } });
    if (!row) return fallback;
    const value = row.value as Partial<JobScheduleConfig> | null;
    if (!value || typeof value !== 'object') return fallback;
    return {
      offsetDays: Number.isFinite(value.offsetDays) && Number(value.offsetDays) >= 0 ? Number(value.offsetDays) : fallback.offsetDays,
      unit: isValidUnit(value.unit) ? value.unit : fallback.unit,
      hour: Number.isInteger(value.hour) && (value.hour as number) >= 0 && (value.hour as number) <= 23 ? (value.hour as number) : fallback.hour,
      minute: Number.isInteger(value.minute) && (value.minute as number) >= 0 && (value.minute as number) <= 59 ? (value.minute as number) : fallback.minute,
    };
  }

  /** Every registered job + this tenant's current (merged) config — the payload for GET /scheduling/jobs. */
  async listJobs(ctx: TenantRequestContext) {
    const definitions = this.registry.listDefinitions();
    const jobs = [];
    for (const def of definitions) {
      jobs.push({ ...def, config: await this.getConfig(ctx.tenantDb, def.code) });
    }
    return jobs;
  }

  async setConfig(ctx: TenantRequestContext, code: string, input: JobScheduleConfig): Promise<JobScheduleConfig> {
    const def = this.registry.getDefinition(code);
    if (!def) throw new NotFoundException(`کار زمان‌بندی‌شده‌ی «${code}» ثبت نشده است`);
    if (!Number.isInteger(input.hour) || input.hour < 0 || input.hour > 23) throw new BadRequestException('ساعت باید عددی بین ۰ تا ۲۳ باشد');
    if (!Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) throw new BadRequestException('دقیقه باید عددی بین ۰ تا ۵۹ باشد');
    const allowed = def.allowedOffsets.some((o) => o.offsetDays === input.offsetDays && o.unit === input.unit);
    if (!allowed) throw new BadRequestException('این بازه‌ی زمانی برای این کار مجاز نیست');

    const value: JobScheduleConfig = { offsetDays: input.offsetDays, unit: input.unit, hour: input.hour, minute: input.minute };
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: code } },
      create: { moduleCode: MODULE_CODE, key: code, value },
      update: { value },
    });
    return value;
  }
}
