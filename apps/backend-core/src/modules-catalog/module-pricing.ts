import type { ModuleDefinition } from '../../generated/control-client/index.js';
import type { ModuleBillingMode } from '../../generated/control-client/index.js';
import { LICENSE_TO_YEARLY_DIVISOR, YEARLY_TO_MONTHLY_DIVISOR } from './module-license-usd.js';

/** سالانه‌ی تعریف‌شده؛ وگرنه ۱۰ برابر ماهانه (دو ماه رایگان) — همان قاعده‌ی مشتق‌شده از قیمت دلاری. */
export function moduleYearlyPrice(m: Pick<ModuleDefinition, 'priceMonthly' | 'priceYearly'>): number {
  return m.priceYearly ?? m.priceMonthly * YEARLY_TO_MONTHLY_DIVISOR;
}

/** قیمت استاندارد لایسنس مادام‌العمر (خرید یک‌باره) — ۴ برابر اشتراک سالانه؛ سالانه ۱۰ برابر ماهانه (module-license-usd.ts). */
export function moduleLicensePrice(m: Pick<ModuleDefinition, 'priceMonthly' | 'priceYearly'>): number {
  return moduleYearlyPrice(m) * LICENSE_TO_YEARLY_DIVISOR;
}

export function modulePriceForMode(
  m: Pick<ModuleDefinition, 'priceMonthly' | 'priceYearly'>,
  mode: ModuleBillingMode,
): number {
  if (mode === 'MONTHLY') return m.priceMonthly;
  if (mode === 'YEARLY') return moduleYearlyPrice(m);
  return moduleLicensePrice(m);
}

export function addBillingPeriod(from: Date, mode: ModuleBillingMode): Date | null {
  if (mode === 'LICENSE') return null;
  const d = new Date(from);
  if (mode === 'MONTHLY') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}
