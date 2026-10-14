import { DEFAULT_PRODUCTION_TRIGGER } from './dispatch-suggestions.js';
import { OPEN_ACCESS, type StepAccess } from './dispatch-scope.js';

export const DISPATCH_MODULE = 'dispatch';
export const SETTINGS_KEY = 'settings';

export type ReceiptRequirement = 'DEPARTURE' | 'DELIVERY' | 'NONE';

export type DispatchSettings = {
  productionTrigger: { enabled: boolean; stagesBeforeEnd: number };
  steps: {
    arrival: StepAccess;
    cleanliness: StepAccess;
    weighing: StepAccess;
    loading: StepAccess;
    finalCheck: StepAccess;
    /** مجوز «آماده حرکت» — علاوه بر مسئول وظیفه‌ی اسناد و مدیر */
    readyToDepart: StepAccess;
    /** تأیید وزن نهایی برای فاکتور */
    weightConfirm: StepAccess;
  };
  receipt: { requiredBefore: ReceiptRequirement; smsEnabled: boolean; smsTemplate: string; archiveEnabled: boolean };
  defaultsSeeded: boolean;
};

export const DEFAULT_RECEIPT_SMS = 'رسید بار شماره {shipmentNo}: لطفاً پس از بارگیری، تحویل صحیح و سالم بار را با امضا تأیید کنید: {link}';

export const DEFAULT_DISPATCH_SETTINGS: DispatchSettings = {
  productionTrigger: { ...DEFAULT_PRODUCTION_TRIGGER },
  steps: {
    arrival: OPEN_ACCESS,
    cleanliness: OPEN_ACCESS,
    weighing: OPEN_ACCESS,
    loading: OPEN_ACCESS,
    finalCheck: OPEN_ACCESS,
    readyToDepart: OPEN_ACCESS,
    weightConfirm: OPEN_ACCESS,
  },
  receipt: { requiredBefore: 'DEPARTURE', smsEnabled: true, smsTemplate: DEFAULT_RECEIPT_SMS, archiveEnabled: true },
  defaultsSeeded: false,
};

const sanitizeAccess = (v: unknown): StepAccess => {
  const o = (v ?? {}) as Partial<StepAccess>;
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === 'string').slice(0, 50) : []);
  return { roleIds: arr(o.roleIds), userIds: arr(o.userIds) };
};

/** ادغام ایمن مقدار ذخیره‌شده با پیش‌فرض‌ها (کلیدهای جدید بعداً هم کار کنند). */
export function mergeSettings(stored: unknown): DispatchSettings {
  const s = (stored ?? {}) as Partial<DispatchSettings>;
  const d = DEFAULT_DISPATCH_SETTINGS;
  const stagesRaw = s.productionTrigger?.stagesBeforeEnd;
  const stages = typeof stagesRaw === 'number' && Number.isInteger(stagesRaw) && stagesRaw >= 0 && stagesRaw <= 20 ? stagesRaw : d.productionTrigger.stagesBeforeEnd;
  const req = s.receipt?.requiredBefore;
  return {
    productionTrigger: { enabled: s.productionTrigger?.enabled ?? d.productionTrigger.enabled, stagesBeforeEnd: stages },
    steps: {
      arrival: sanitizeAccess(s.steps?.arrival),
      cleanliness: sanitizeAccess(s.steps?.cleanliness),
      weighing: sanitizeAccess(s.steps?.weighing),
      loading: sanitizeAccess(s.steps?.loading),
      finalCheck: sanitizeAccess(s.steps?.finalCheck),
      readyToDepart: sanitizeAccess(s.steps?.readyToDepart),
      weightConfirm: sanitizeAccess(s.steps?.weightConfirm),
    },
    receipt: {
      requiredBefore: req === 'DEPARTURE' || req === 'DELIVERY' || req === 'NONE' ? req : d.receipt.requiredBefore,
      smsEnabled: s.receipt?.smsEnabled ?? d.receipt.smsEnabled,
      smsTemplate: typeof s.receipt?.smsTemplate === 'string' && s.receipt.smsTemplate.trim() ? s.receipt.smsTemplate.slice(0, 500) : d.receipt.smsTemplate,
      archiveEnabled: s.receipt?.archiveEnabled ?? d.receipt.archiveEnabled,
    },
    defaultsSeeded: s.defaultsSeeded === true,
  };
}
