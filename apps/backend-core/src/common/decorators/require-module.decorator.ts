import { SetMetadata } from '@nestjs/common';

export const REQUIRE_MODULE_KEY = 'requireModule';

/**
 * محدود می‌کند که این کنترلر/متد فقط وقتی در دسترس تننت باشد که ماژول
 * داده‌شده نصب شده باشد (یا isCore باشد، که همیشه برای همه فعال است).
 * ماژول‌های پایه (crm، warehouse، tasks) اصلاً نیازی به این دکوریتور ندارند.
 */
export const RequireModule = (moduleCode: string) => SetMetadata(REQUIRE_MODULE_KEY, moduleCode);
