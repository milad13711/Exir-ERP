import { SetMetadata } from '@nestjs/common';

export const API_KEY_SELF_SCOPED_KEY = 'apiKeySelfScoped';

/**
 * روتی که خودش دامنه‌ی کلید API را اعمال می‌کند (مثل /mcp که POST است ولی ابزارهای READ را اجرا می‌کند و ابزارهای write را فقط
 * به صف تأیید می‌فرستد). گارد سراسری قاعده‌ی «متد نوشتنی نیازمند write» و «فقط ماژول‌های مجاز» را روی آن اعمال نمی‌کند.
 */
export const ApiKeySelfScoped = () => SetMetadata(API_KEY_SELF_SCOPED_KEY, true);
