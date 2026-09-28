import { Injectable } from '@nestjs/common';
import type { JobScheduleConfig } from './schedule-match.util.js';

export type { JobScheduleConfig, ScheduleOffsetUnit } from './schedule-match.util.js';

export type SchedulableJobDefinition = {
  /** stable identifier, doubles as the ModuleSetting key under moduleCode 'scheduling' */
  code: string;
  /** Persian display name for the settings UI */
  label: string;
  /** which module this job belongs to, for grouping in the settings UI */
  moduleCode: string;
  /** used when the tenant has never saved an override */
  defaultConfig: JobScheduleConfig;
  /** the small preset list this job supports (both the offset presets and, redundantly, its own hour/minute — only offsetDays/unit differ between entries; the UI lets hour/minute be picked separately) */
  allowedOffsets: JobScheduleConfig[];
  /** true for the handful of jobs whose actual firing was rewired to consult the tenant's saved config; false means the job is listed for visibility/future work but still runs on its original fixed schedule */
  behaviorWired: boolean;
};

/**
 * Registry for cron-based reminder jobs that want to expose "when do you
 * fire" as a per-tenant Settings choice, mirroring the registerHandler
 * pattern in ApprovalsService (apps/backend-core/src/approvals/approvals.service.ts):
 * each cron service calls `registerJob` once from its own `onModuleInit`,
 * and SchedulingController reads the list back for the settings UI.
 */
@Injectable()
export class SchedulableJobRegistryService {
  private readonly definitions = new Map<string, SchedulableJobDefinition>();

  registerJob(definition: SchedulableJobDefinition): void {
    this.definitions.set(definition.code, definition);
  }

  getDefinition(code: string): SchedulableJobDefinition | undefined {
    return this.definitions.get(code);
  }

  listDefinitions(): SchedulableJobDefinition[] {
    return [...this.definitions.values()];
  }
}

/** Small helper so every cron service doesn't repeat the same object shape for its preset list. */
export function offsetPreset(offsetDays: number, unit: JobScheduleConfig['unit'], hour: number, minute = 0): JobScheduleConfig {
  return { offsetDays, unit, hour, minute };
}

/** The generic "small preset list" most day-offset reminder jobs are fine sharing: ۵/۳/۲/۱ روز قبل، همان روز، ۱/۳/۷ روز بعد. */
export function standardOffsetPresets(hour: number, minute = 0): JobScheduleConfig[] {
  return [
    offsetPreset(5, 'DAYS_BEFORE', hour, minute),
    offsetPreset(3, 'DAYS_BEFORE', hour, minute),
    offsetPreset(2, 'DAYS_BEFORE', hour, minute),
    offsetPreset(1, 'DAYS_BEFORE', hour, minute),
    offsetPreset(0, 'SAME_DAY', hour, minute),
    offsetPreset(1, 'DAYS_AFTER', hour, minute),
    offsetPreset(3, 'DAYS_AFTER', hour, minute),
    offsetPreset(7, 'DAYS_AFTER', hour, minute),
  ];
}
