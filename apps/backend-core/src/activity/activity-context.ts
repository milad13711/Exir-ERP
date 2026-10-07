import { AsyncLocalStorage } from 'node:async_hooks';

export type ActorType = 'MANUAL' | 'AUTOMATIC' | 'SYSTEM';

/** هویت «چه کسی این کار را راه انداخت» در طول یک درخواست — برای نسبت‌دادن پیامک/اقدام‌های فرعی به کاربر. */
export type ActivityActor = {
  actorType: ActorType;
  /** GlobalUser.id از JWT (برای کلید API: id کلید) */
  globalUserId?: string;
  viaApiKey?: boolean;
  tenantId?: string;
  moduleCode?: string;
  /** برچسب منشأ برای درخواست‌های عمومی/بدون کاربر، مثل public:booking */
  origin?: string;
};

export const activityActorStorage = new AsyncLocalStorage<ActivityActor>();

export function currentActor(): ActivityActor | undefined {
  return activityActorStorage.getStore();
}
