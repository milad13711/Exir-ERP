import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';

const MODULE_CODE = 'book-store';
const SETTINGS_KEY = 'settings';

/**
 * قیمت هر نسخه + پیوند نسخه‌ی چاپی به یک کالای انبار. پیش از افزودن این
 * تنظیمات، قیمت‌ها در BOOK_ORDER_FORMATS هاردکد بودند — این مقادیر همان
 * پیش‌فرض‌ها هستند تا برای تننت‌های موجود رفتار عوض نشود، اما اکنون هر تننت
 * می‌تواند آن‌ها را از پنل مدیریت تغییر دهد.
 *
 * printProductId عمداً به‌صورت پیش‌فرض خالی می‌ماند (نه خودکار ساخته‌شده) —
 * مطابق قاعده‌ی این پروژه که تنظیمات حساس (مثل CertificateTemplateSettings)
 * باید صراحتاً توسط مدیر تننت پیکربندی شوند، نه به‌صورت جادویی حدس زده شوند.
 * تا وقتی خالی است، فروش نسخه‌ی چاپی به انبار متصل نمی‌شود (و موجودی کسر
 * نمی‌شود) — این رفتار عمدی و امن است، نه یک باگ.
 */
export type BookStoreSettings = {
  printPriceToman: number;
  ebookPriceToman: number;
  audioPriceToman: number;
  /** کالای انبار متناظر با نسخه‌ی چاپی — وقتی خالی است، ارسال نسخه‌ی چاپی موجودی انبار را کم نمی‌کند. */
  printProductId: string | null;
};

export const DEFAULT_BOOK_STORE_SETTINGS: BookStoreSettings = {
  printPriceToman: 1_400_000,
  ebookPriceToman: 650_000,
  audioPriceToman: 850_000,
  printProductId: null,
};

@Injectable()
export class BookStoreSettingsService {
  async get(ctx: TenantRequestContext): Promise<BookStoreSettings> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: SETTINGS_KEY } },
    });
    if (!row) return { ...DEFAULT_BOOK_STORE_SETTINGS };
    const stored = row.value as Partial<BookStoreSettings>;
    return {
      printPriceToman: Number.isFinite(stored.printPriceToman) ? Number(stored.printPriceToman) : DEFAULT_BOOK_STORE_SETTINGS.printPriceToman,
      ebookPriceToman: Number.isFinite(stored.ebookPriceToman) ? Number(stored.ebookPriceToman) : DEFAULT_BOOK_STORE_SETTINGS.ebookPriceToman,
      audioPriceToman: Number.isFinite(stored.audioPriceToman) ? Number(stored.audioPriceToman) : DEFAULT_BOOK_STORE_SETTINGS.audioPriceToman,
      printProductId: typeof stored.printProductId === 'string' && stored.printProductId ? stored.printProductId : null,
    };
  }

  /** فقط مالک/مدیر — همان قاعده‌ی این پروژه برای تنظیمات سطح تننت (نک: CertificateTemplateSettingsService). */
  async update(ctx: TenantRequestContext, dto: Partial<BookStoreSettings>): Promise<BookStoreSettings> {
    if (ctx.auth.role !== 'OWNER' && ctx.auth.role !== 'ADMIN') {
      throw new ForbiddenException('فقط مالک یا مدیر محیط کاری می‌تواند تنظیمات فروش کتاب را تغییر دهد');
    }
    if (dto.printProductId) {
      const product = await ctx.tenantDb.product.findUnique({ where: { id: dto.printProductId }, select: { id: true } });
      if (!product) throw new ForbiddenException('کالای انتخاب‌شده برای نسخه‌ی چاپی یافت نشد');
    }
    const current = await this.get(ctx);
    const next: BookStoreSettings = {
      printPriceToman: dto.printPriceToman !== undefined && dto.printPriceToman > 0 ? Math.round(dto.printPriceToman) : current.printPriceToman,
      ebookPriceToman: dto.ebookPriceToman !== undefined && dto.ebookPriceToman > 0 ? Math.round(dto.ebookPriceToman) : current.ebookPriceToman,
      audioPriceToman: dto.audioPriceToman !== undefined && dto.audioPriceToman > 0 ? Math.round(dto.audioPriceToman) : current.audioPriceToman,
      printProductId: dto.printProductId !== undefined ? dto.printProductId || null : current.printProductId,
    };
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: MODULE_CODE, key: SETTINGS_KEY } },
      create: { moduleCode: MODULE_CODE, key: SETTINGS_KEY, value: next },
      update: { value: next },
    });
    return next;
  }
}
