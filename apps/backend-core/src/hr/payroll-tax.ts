import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

const SETTINGS_MODULE = 'payroll';
const SETTINGS_KEY = 'taxInsuranceRates';

export type PayrollTaxSettings = {
  insuranceEmployeeRate: number; // درصد — سهم بیمه‌ی کارمند از حقوق ناخالص (پیش‌فرض تأمین اجتماعی: ۷٪)
  taxExemptionMonthly: number; // تومان — سقف معافیت مالیاتی ماهانه؛ این عدد هرساله در قانون بودجه تغییر می‌کند و باید دستی به‌روز شود
  taxRate: number; // درصد — نرخ مالیات بر مازاد سقف معافیت (مدل ساده‌شده‌ی تک‌پله‌ای، نه تصاعدی چندپله‌ای واقعی)
};

const DEFAULT_SETTINGS: PayrollTaxSettings = {
  insuranceEmployeeRate: 7,
  taxExemptionMonthly: 0,
  taxRate: 10,
};

export async function getPayrollTaxSettings(db: TenantPrismaClient): Promise<PayrollTaxSettings> {
  const setting = await db.moduleSetting.findUnique({
    where: { moduleCode_key: { moduleCode: SETTINGS_MODULE, key: SETTINGS_KEY } },
  });
  if (!setting) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(setting.value as Partial<PayrollTaxSettings>) };
}

export async function setPayrollTaxSettings(db: TenantPrismaClient, settings: PayrollTaxSettings): Promise<void> {
  await db.moduleSetting.upsert({
    where: { moduleCode_key: { moduleCode: SETTINGS_MODULE, key: SETTINGS_KEY } },
    create: { moduleCode: SETTINGS_MODULE, key: SETTINGS_KEY, value: settings },
    update: { value: settings },
  });
}

/**
 * بیمه‌ی سهم کارمند روی حقوق ناخالص (پایه + مزایا) محاسبه می‌شود؛ مالیات
 * روی همان مبلغ منهای بیمه و سقف معافیت — مدل ساده‌شده‌ی تک‌پله‌ای، نه
 * جدول تصاعدی چندپله‌ی واقعی قانون مالیات مستقیم.
 */
export function computePayrollDeductions(
  grossPay: number,
  settings: PayrollTaxSettings,
): { insuranceAmount: number; taxAmount: number } {
  const insuranceAmount = Math.round(grossPay * (settings.insuranceEmployeeRate / 100));
  const taxableBase = Math.max(0, grossPay - insuranceAmount - settings.taxExemptionMonthly);
  const taxAmount = Math.round(taxableBase * (settings.taxRate / 100));
  return { insuranceAmount, taxAmount };
}
