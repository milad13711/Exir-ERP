/** ثابت‌های مشترک ماژول نمایندگی (agents). بدون import از prisma/ — در ایمیج اجرایی هم امن است. */

export const AGENTS_MODULE_CODE = 'agents';
export const AGENT_ROLE_NAME = 'نماینده';

export const AGENT_LEVELS = ['B', 'A', 'A_PLUS'] as const;
export type AgentLevel = (typeof AGENT_LEVELS)[number];
export const AGENT_LEVEL_LABELS: Record<AgentLevel, string> = { B: 'سطح B', A: 'سطح A', A_PLUS: 'سطح A+' };

export const MEMBERSHIP_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'ENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const FUNNEL_STAGES = ['LEAD', 'REGISTERED', 'TRIAL', 'PAID', 'RENEWED', 'LOST'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  LEAD: 'سرنخ',
  REGISTERED: 'ثبت‌نام‌شده',
  TRIAL: 'آزمایشی',
  PAID: 'پرداخت‌کرده',
  RENEWED: 'تمدیدکرده',
  LOST: 'ازدست‌رفته',
};

export const PAYMENT_EVENT_TYPES = ['PAYMENT_FIRST', 'PAYMENT_RENEWAL', 'REFUND'] as const;
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/** پیش‌فرض‌ها: مهلت نگهداری کمیسیون و حداقل مبلغ تسویه (تومان). */
export const DEFAULT_HOLD_DAYS = 7;
export const DEFAULT_MIN_SETTLEMENT_TOMAN = 500_000;

/** ریشه‌ی API ورودی محصولات (پس از پیشوند عمومی /api). */
export const AGENT_API_BASE = '/agents-api/v1';
export const AGENT_KEY_PREFIX = 'exir_agent_';
export const AGENT_SIGN_PREFIX = 'exir_sign_';

/** تننت رجیستری پلتفرم (همان قرارداد ReferralSyncService/ResellerApplicationsService). */
export function registrySlug(): string {
  return process.env.RESELLER_REGISTRY_TENANT_SLUG ?? 'eta';
}
