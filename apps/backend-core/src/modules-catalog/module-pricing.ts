import type { ModuleDefinition } from '../../generated/control-client/index.js';
import type { ModuleBillingMode } from '../../generated/control-client/index.js';

/** بدون تخفیف سالانه‌ی تعریف‌شده در کاتالوگ، معادل ۱۲ ماه محاسبه می‌شود. */
export function moduleYearlyPrice(m: Pick<ModuleDefinition, 'priceMonthly' | 'priceYearly'>): number {
  return m.priceYearly ?? m.priceMonthly * 12;
}

/** قیمت استاندارد لایسنس (خرید یک‌باره) — همیشه ۸ برابر اشتراک سالانه، بدون تخفیف. */
export function moduleLicensePrice(m: Pick<ModuleDefinition, 'priceMonthly' | 'priceYearly'>): number {
  return moduleYearlyPrice(m) * 8;
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
