import { Logger } from '@nestjs/common';
import { loadSecretsKey } from '../tax/crypto/secret-box.js';
import { ACK_DOMAIN, ROTATE_DOMAIN, deriveKey } from './push-logic.js';

const logger = new Logger('PushTokens');
let warned = false;

/**
 * کلید اصلیِ توکن‌های پوش: APP_SECRETS_KEY (۳۲ بایت). در production اگر ناقص/خراب/غایب باشد fail-closed است
 * (توکن صادر/پذیرفته نمی‌شود، ack و چرخش خودکار غیرفعال) و یک‌بار خطای بلند لاگ می‌شود؛ هرگز بی‌صدا به کلید دیگری برنمی‌گردد.
 * فقط در توسعه/تست، VAPID_PRIVATE_KEY به‌عنوان کلید مصرف می‌شود.
 */
function master(): Buffer | string | null {
  try {
    return loadSecretsKey(process.env.APP_SECRETS_KEY);
  } catch {
    if (process.env.NODE_ENV === 'production') {
      if (!warned) {
        warned = true;
        logger.error('APP_SECRETS_KEY missing/invalid in production: push ack & subscription-rotation tokens are DISABLED (fail-closed)');
      }
      return null;
    }
    return process.env.VAPID_PRIVATE_KEY || null;
  }
}

export function ackKey(): Buffer | null {
  const m = master();
  return m ? deriveKey(m, ACK_DOMAIN) : null;
}

export function rotateKey(): Buffer | null {
  const m = master();
  return m ? deriveKey(m, ROTATE_DOMAIN) : null;
}
