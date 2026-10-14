/** منطق خالص پیشنهاد اعلام بار — ماشه‌ی تولید، ضدتکرار منبع. */

export const DEFAULT_PRODUCTION_TRIGGER = { enabled: true, stagesBeforeEnd: 0 } as const;

export type SuggestionSourceType = 'PRODUCTION_ORDER' | 'SALES_INVOICE' | 'STOCK_MOVEMENT';

export const suggestionKey = (type: SuggestionSourceType, id: string) => `${type}:${id}`;

/** N مرحله مانده به پایان: override دستور تولید اولویت دارد، وگرنه پیش‌فرض تننت. */
export function resolveStagesBeforeEnd(orderOverride: number | null | undefined, tenantDefault: number): number {
  const v = orderOverride ?? tenantDefault;
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

export type ProductionFacts = {
  status: string;
  totalStages: number;
  doneStages: number;
  stagesBeforeEnd: number;
};

const ACTIVE = new Set(['IN_PROGRESS', 'QC_PENDING', 'COMPLETED']);

/**
 * ۰ = آخرین مرحله (فقط یک مرحله‌ی ناتمام مانده)، ۱ = دومین مرحله از آخر، …
 * دستور بدون مرحله فقط در QC_PENDING/COMPLETED پیشنهاد می‌دهد. پیش‌نویس/لغو/ردشده هرگز.
 */
export function shouldSuggestForProduction(f: ProductionFacts): boolean {
  if (!ACTIVE.has(f.status)) return false;
  if (f.totalStages === 0) return f.status === 'QC_PENDING' || f.status === 'COMPLETED';
  const remaining = f.totalStages - f.doneStages;
  return remaining <= f.stagesBeforeEnd + 1;
}

export type ExistingShipmentRef = { id: string; status: string; shipmentNo?: number };

/** ضدتکرار: اگر برای همان منبع بار فعال (غیرلغو) وجود دارد، ساخت دوباره ممنوع و همان برگردانده می‌شود. */
export function decideSourceAction(existing: ExistingShipmentRef[]): { action: 'CREATE' } | { action: 'EXISTS'; shipment: ExistingShipmentRef } {
  const live = existing.filter((s) => s.status !== 'CANCELLED');
  return live.length > 0 ? { action: 'EXISTS', shipment: live[0] } : { action: 'CREATE' };
}
