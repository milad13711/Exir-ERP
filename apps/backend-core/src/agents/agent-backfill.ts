/**
 * نگاشت ایمن داده‌ی قدیمی ResellerProfile به ساختار چندمحصولی. همین منطق را مایگریشن SQL
 * (`20261108100000_agents_module`) به‌صورت INSERT … ON CONFLICT DO NOTHING اجرا می‌کند؛ این نسخه‌ی خالص برای تست و اجرای دستی است.
 */
import type { AgentLevel, MembershipStatus } from './agent-constants.js';

export const LEGACY_PRODUCT_NAMES: Record<string, string> = {
  ERP: 'اکسیر ERP',
  REAL_ESTATE: 'اکسیر املاک',
  SMS_GATEWAY: 'پنل پیامک اکسیر',
  OTHER: 'سایر محصولات',
};

/** ResellerTier (A_PLUS | A | B) → سطح عضویت؛ مقدار ناشناخته به B (پایین‌ترین) برمی‌گردد. */
export function tierToLevel(tier: string | null | undefined): AgentLevel {
  return tier === 'A_PLUS' ? 'A_PLUS' : tier === 'A' ? 'A' : 'B';
}

/** سطح عضویت → ResellerTier قدیمی (برای سازگاری گزارش‌های قدیمی). */
export function levelToTier(level: string): 'A_PLUS' | 'A' | 'B' {
  return level === 'A_PLUS' ? 'A_PLUS' : level === 'A' ? 'A' : 'B';
}

/** ResellerCooperationStatus → وضعیت عضویت. END_REQUESTED هنوز فعال است تا مدیر تأیید کند. */
export function cooperationToMembershipStatus(status: string | null | undefined): MembershipStatus {
  return status === 'ENDED' ? 'ENDED' : 'ACTIVE';
}

export type LegacyProfileRow = {
  id: string;
  productCode: string | null;
  tier: string;
  cooperationStatus: string;
  createdAt: Date;
  endedAt: Date | null;
  endReason: string | null;
};
export type ExistingMembershipKey = { resellerProfileId: string; productCode: string };
export type PlannedMembership = {
  resellerProfileId: string;
  productCode: string;
  level: AgentLevel;
  status: MembershipStatus;
  startedAt: Date;
  endedAt: Date | null;
  endReason: string | null;
};

/** عضویت‌هایی که باید ساخته شوند — idempotent: ردیف موجود (پروفایل×محصول) دوباره پیشنهاد نمی‌شود. */
export function planMembershipBackfill(profiles: LegacyProfileRow[], existing: ExistingMembershipKey[]): { products: string[]; memberships: PlannedMembership[] } {
  const have = new Set(existing.map((e) => `${e.resellerProfileId}:${e.productCode}`));
  const products = new Set<string>();
  const memberships: PlannedMembership[] = [];
  for (const p of profiles) {
    if (!p.productCode) continue;
    products.add(p.productCode);
    if (have.has(`${p.id}:${p.productCode}`)) continue;
    have.add(`${p.id}:${p.productCode}`);
    memberships.push({
      resellerProfileId: p.id,
      productCode: p.productCode,
      level: tierToLevel(p.tier),
      status: cooperationToMembershipStatus(p.cooperationStatus),
      startedAt: p.createdAt,
      endedAt: p.endedAt,
      endReason: p.endReason,
    });
  }
  return { products: [...products], memberships };
}
