import { ConflictException } from '@nestjs/common';

/**
 * حذف امن: اگر رکورد هنوز به رکوردهای دیگر (فاکتور، نوبت، پرداخت، ...) وصل باشد، دیتابیس با خطای
 * کلید خارجی (P2003/P2014) جلویش را می‌گیرد؛ آن را به پیام روشن فارسی تبدیل می‌کنیم.
 */
export async function safeDelete<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'P2003' || code === 'P2014') {
      throw new ConflictException('این رکورد به سوابق دیگر (فاکتور، نوبت، پرداخت و ...) وصل است و حذف نمی‌شود؛ به‌جای حذف آن را غیرفعال یا لغو کنید.');
    }
    throw err;
  }
}
