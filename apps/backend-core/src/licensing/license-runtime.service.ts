import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InvalidLicenseError, verifyLicenseToken, type LicensePayload } from './license-token.js';

const GRACE_PERIOD_DAYS = 7;
// 15min — best-effort, never blocking. Was 6h (fine for pure revocation-checking);
// shortened so admin-panel's "last seen" connectivity indicator on the licenses
// page stays meaningfully fresh instead of only updating a few times a day.
const CHECK_IN_INTERVAL_MS = 15 * 60 * 1000;

export type LicenseStatus =
  | { mode: 'cloud' }
  | { mode: 'on_premise'; state: 'valid' | 'grace'; payload: LicensePayload; daysLeft: number }
  | { mode: 'on_premise'; state: 'invalid' | 'expired'; reason: string };

/**
 * Loaded once at boot from LICENSE_KEY + LICENSE_PUBLIC_KEY_PEM — an
 * on-premise deployment verifies its own license completely offline, with
 * no dependency on reaching the Control Plane. If CONTROL_PLANE_CHECKIN_URL
 * is set, it also best-effort checks in periodically to catch a revocation
 * before the token's own expiry; any network failure there is swallowed —
 * offline-first is the entire point of this design.
 */
@Injectable()
export class LicenseRuntimeService implements OnModuleInit {
  private readonly logger = new Logger('LicenseRuntimeService');
  private status: LicenseStatus = { mode: 'cloud' };

  onModuleInit(): void {
    if (process.env.DEPLOYMENT_MODE !== 'ON_PREMISE') {
      this.status = { mode: 'cloud' };
      return;
    }
    this.loadFromEnv();
    if (process.env.CONTROL_PLANE_CHECKIN_URL) {
      void this.checkIn(); // فوری هم یک بار — تا وضعیت «آخرین اتصال» بدون ۱۵ دقیقه تأخیر اول بروز شود
      setInterval(() => this.checkIn(), CHECK_IN_INTERVAL_MS).unref();
    }
  }

  private loadFromEnv(): void {
    const licenseKey = process.env.LICENSE_KEY;
    const publicKeyPem = process.env.LICENSE_PUBLIC_KEY_PEM?.replace(/\\n/g, '\n');

    if (!licenseKey || !publicKeyPem) {
      this.status = { mode: 'on_premise', state: 'invalid', reason: 'کد لایسنس یا کلید عمومی تنظیم نشده است' };
      this.logger.error('DEPLOYMENT_MODE=ON_PREMISE but LICENSE_KEY / LICENSE_PUBLIC_KEY_PEM is missing');
      return;
    }

    try {
      const payload = verifyLicenseToken(licenseKey, publicKeyPem);
      this.applyPayload(payload);
    } catch (err) {
      const reason = err instanceof InvalidLicenseError ? err.message : 'خطای نامشخص در بررسی لایسنس';
      this.status = { mode: 'on_premise', state: 'invalid', reason };
      this.logger.error(`license verification failed: ${reason}`);
    }
  }

  private applyPayload(payload: LicensePayload): void {
    const now = new Date();
    const expiresAt = new Date(payload.expiresAt);
    const graceEnd = new Date(expiresAt);
    graceEnd.setDate(graceEnd.getDate() + GRACE_PERIOD_DAYS);

    if (now <= expiresAt) {
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      this.status = { mode: 'on_premise', state: 'valid', payload, daysLeft };
    } else if (now <= graceEnd) {
      const daysLeft = Math.ceil((graceEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      this.status = { mode: 'on_premise', state: 'grace', payload, daysLeft };
      this.logger.warn(`license expired ${payload.expiresAt}, in ${daysLeft}-day grace period`);
    } else {
      this.status = {
        mode: 'on_premise',
        state: 'expired',
        reason: `لایسنس در تاریخ ${payload.expiresAt} منقضی شده و مهلت اضافه (${GRACE_PERIOD_DAYS} روز) نیز به پایان رسیده است`,
      };
    }
  }

  private async checkIn(): Promise<void> {
    const url = process.env.CONTROL_PLANE_CHECKIN_URL;
    const licenseKey = process.env.LICENSE_KEY;
    if (!url || !licenseKey) return;
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/api/licenses/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseKey }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json()) as { valid: boolean; reason?: string };
      if (!body.valid) {
        this.status = { mode: 'on_premise', state: 'invalid', reason: body.reason ?? 'لایسنس توسط پشتیبانی ابطال شده است' };
        this.logger.error(`license check-in reports revoked: ${body.reason}`);
      }
    } catch (err) {
      // No connectivity, or the Control Plane is unreachable — stay on the
      // last locally-verified offline status. Never fail closed on this.
      this.logger.debug(`license check-in skipped (offline): ${(err as Error).message}`);
    }
  }

  getStatus(): LicenseStatus {
    return this.status;
  }

  isBlocked(): boolean {
    return this.status.mode === 'on_premise' && (this.status.state === 'invalid' || this.status.state === 'expired');
  }

  moduleAllowed(code: string): boolean {
    if (this.status.mode === 'cloud') return true;
    if (this.status.state === 'valid' || this.status.state === 'grace') {
      return this.status.payload.modules.includes(code);
    }
    return false;
  }
}
