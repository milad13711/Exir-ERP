import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * فقط http/https مطلق (حداکثر ۵۰۰ نویسه). رشته‌ی خالی هم مجاز است (یعنی «پاک‌کردن»).
 * چرا: فیلدهایی مثل websiteUrl که از فرم عمومی می‌آیند در پنل ادمین به‌صورت <a href> نمایش داده می‌شوند؛
 * مقدار `javascript:...` با یک کلیک ادمین = XSS ذخیره‌شده و سرقت توکن نشست.
 */
export function isHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '') return true;
  if (v.length > 500) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

export function IsHttpUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isHttpUrl',
      target: object.constructor,
      propertyName,
      options: { message: 'آدرس باید یک لینک معتبر http/https باشد', ...options },
      validator: { validate: isHttpUrl },
    });
  };
}
