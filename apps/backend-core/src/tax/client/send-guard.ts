import { createHash } from 'node:crypto';
import { normalizeJson } from '../crypto/normalize.js';
import type { ClientSettingsView, SendPermit } from './moodian-client.js';

export class SendRefusedError extends Error {
  constructor(
    public readonly reason: 'SENDING_DISABLED' | 'PRODUCTION_NOT_VERIFIED' | 'NOT_APPROVED' | 'PAYLOAD_CHANGED' | 'NOT_CONFIGURED',
    message: string,
  ) {
    super(message);
    this.name = 'SendRefusedError';
  }
}

export const hashNormalized = (invoice: unknown): string => createHash('sha256').update(normalizeJson(invoice), 'utf8').digest('hex');

/**
 * سه شرط سخت ارسال (در کلاینت واقعی، کلاینت جعلی و سرویس تکرار می‌شود — دفاع در عمق):
 *   ۱) sendingEnabled=false → ممنوع
 *   ۲) محیط واقعی بدون verifiedAgainstSandboxAt → ممنوع
 *   ۳) وضعیت باید APPROVED (یا QUEUED پس از تأیید) با approvedAt/approvedByUserId و بدون تغییر محتوا باشد
 */
export function assertSendAllowed(settings: ClientSettingsView, permit: SendPermit): void {
  if (!settings.sendingEnabled) throw new SendRefusedError('SENDING_DISABLED', 'ارسال واقعی غیرفعال است');
  if (settings.environment === 'PRODUCTION' && !settings.verifiedAgainstSandboxAt) {
    throw new SendRefusedError('PRODUCTION_NOT_VERIFIED', 'ارسال به محیط واقعی بدون تأیید موفق در محیط آزمایشی ممنوع است');
  }
  if ((permit.status !== 'APPROVED' && permit.status !== 'QUEUED') || !permit.approvedAt || !permit.approvedByUserId) {
    throw new SendRefusedError('NOT_APPROVED', 'فقط صورتحساب تأییدشده‌ی مدیر قابل ارسال است');
  }
  if (!permit.expectedHash || hashNormalized(permit.invoice) !== permit.expectedHash) {
    throw new SendRefusedError('PAYLOAD_CHANGED', 'محتوای صورتحساب پس از تأیید تغییر کرده است');
  }
}
