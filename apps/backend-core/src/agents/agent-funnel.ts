/** گذارهای مجاز قیف مشتری نماینده + نگاشت رویداد API → مرحله. خالص و تست‌پذیر. */
import type { FunnelStage } from './agent-constants.js';

export type FunnelEventKind = 'customer.registered' | 'subscription.activated' | 'subscription.renewed' | 'subscription.cancelled' | 'payment.refunded';

/** مرحله‌ی هدف یک رویداد، با توجه به مرحله‌ی فعلی؛ null = بدون تغییر. */
export function stageAfterEvent(current: FunnelStage | null, event: FunnelEventKind, opts: { isTrial?: boolean } = {}): FunnelStage | null {
  switch (event) {
    case 'customer.registered':
      return current === null ? 'REGISTERED' : current === 'LEAD' || current === 'LOST' ? 'REGISTERED' : null;
    case 'subscription.activated':
      if (opts.isTrial) return current === null || current === 'LEAD' || current === 'REGISTERED' || current === 'LOST' ? 'TRIAL' : null;
      return current === 'PAID' || current === 'RENEWED' ? null : 'PAID';
    case 'subscription.renewed':
      return current === 'RENEWED' ? null : 'RENEWED';
    case 'subscription.cancelled':
      return current === 'LOST' ? null : 'LOST';
    case 'payment.refunded':
      return null; // بازپرداخت مرحله را عوض نمی‌کند؛ لغو اشتراک جداگانه می‌آید
  }
}

/** تغییر دستی ادمین: هر مرحله‌ی معتبر به هر مرحله‌ی معتبر دیگر مجاز است (به‌جز بدون‌تغییر). */
export function isManualTransitionAllowed(from: string, to: string, stages: readonly string[]): boolean {
  return from !== to && stages.includes(to);
}
