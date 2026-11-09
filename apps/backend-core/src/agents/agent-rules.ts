/** انتخاب قانون کمیسیون نسخه‌دار: آخرین قانون (محصول، سطح) با effectiveFrom ≤ لحظه‌ی رویداد. خالص. */
export type RuleLike = { level: string; firstPaymentPercent: number; renewalPercent: number; effectiveFrom: Date; id?: string };

export function pickRule<T extends RuleLike>(rules: T[], level: string, at: Date): T | null {
  let best: T | null = null;
  for (const r of rules) {
    if (r.level !== level || r.effectiveFrom.getTime() > at.getTime()) continue;
    if (!best || r.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = r;
  }
  return best;
}

export type EffectiveRates = { firstPaymentPercent: number; renewalPercent: number; source: 'RULE' | 'LEGACY_PROFILE'; ruleId: string | null; effectiveFrom: Date | null };

/** قانون محصول/سطح؛ اگر نبود، درصدهای قدیمی ResellerProfile (برای سازگاری). */
export function resolveRates<T extends RuleLike>(rules: T[], level: string, at: Date, legacy: { first: number; renewal: number }): EffectiveRates {
  const r = pickRule(rules, level, at);
  if (r) return { firstPaymentPercent: r.firstPaymentPercent, renewalPercent: r.renewalPercent, source: 'RULE', ruleId: r.id ?? null, effectiveFrom: r.effectiveFrom };
  return { firstPaymentPercent: legacy.first, renewalPercent: legacy.renewal, source: 'LEGACY_PROFILE', ruleId: null, effectiveFrom: null };
}
