import { SetMetadata } from '@nestjs/common';

export const HUMAN_ONLY_KEY = 'humanOnly';
export const API_KEY_ALLOWED_KEY = 'apiKeyAllowed';

/** مسیر فقط برای نشست انسانی؛ هر کلید API (حتی قدیمی/کامل) ۴۰۳ می‌گیرد. */
export const HumanOnly = () => SetMetadata(HUMAN_ONLY_KEY, true);

/** استثنای صریح: مسیری که @Roles دارد ولی برای کلید API هم مجاز است. */
export const ApiKeyAllowed = () => SetMetadata(API_KEY_ALLOWED_KEY, true);
