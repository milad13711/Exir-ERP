/**
 * قرارداد مشترک بین پیاده‌سازی‌های درگاه (زرین‌پال، بیت‌پی، ...). هر پیاده‌سازی
 * فقط با HTTP درگاه صحبت می‌کند و به Prisma/TenantRequestContext وابسته نیست —
 * تا هم تست واحدش ساده باشد و هم بعداً درگاه جدید بدون تغییر لایه‌ی بالاتر اضافه شود.
 */

export type GatewayCreateResult = { authority: string; redirectUrl: string } | null;

export type GatewayVerifyResult = { success: boolean; refId?: string };

/** برای تزریق `fetch` در تست‌ها بدون نیاز به HTTP واقعی. */
export type FetchLike = typeof fetch;
