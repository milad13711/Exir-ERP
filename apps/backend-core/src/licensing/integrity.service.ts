import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublicKeyringFromEnv } from './license-crypto.js';
import { verifyManifestDir, type IntegrityResult } from './integrity-manifest.js';

const INTERVAL_MS = 6 * 3600_000;

/**
 * راستی‌آزمای یکپارچگی کد در زمان اجرا (بوت + دوره‌ای). فقط وقتی فعال است که DEPLOYMENT_MODE=ON_PREMISE یا INTEGRITY_VERIFY=true.
 * خروجی به check-in لایسنس گزارش می‌شود و سیاست (WARN|LOCK) را سرور لایسنس در توکن تعیین می‌کند — نه env مشتری.
 */
@Injectable()
export class IntegrityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Integrity');
  private result: IntegrityResult = { status: 'disabled', modified: [], added: [], missing: [], builtAt: null, version: null, checkedAt: new Date().toISOString() };
  private timer?: NodeJS.Timeout;

  get enabled(): boolean {
    return process.env.DEPLOYMENT_MODE === 'ON_PREMISE' || process.env.INTEGRITY_VERIFY === 'true';
  }

  distDir(): string {
    return process.env.INTEGRITY_DIST_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    await this.check();
    this.timer = setInterval(() => void this.check(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<IntegrityResult> {
    try {
      this.result = await verifyManifestDir(this.distDir(), loadPublicKeyringFromEnv());
    } catch (err) {
      this.result = { ...this.result, status: 'manifest_invalid', checkedAt: new Date().toISOString() };
      this.logger.error(`integrity check failed: ${(err as Error).message}`);
    }
    if (this.result.status !== 'ok') {
      this.logger.warn(
        `integrity status=${this.result.status} modified=${this.result.modified.length} added=${this.result.added.length} missing=${this.result.missing.length}`,
      );
    }
    return this.result;
  }

  getResult(): IntegrityResult {
    return this.result;
  }

  /** وضعیتی که «مشکل‌دار» حساب می‌شود (برای سیاست LOCK). manifest_missing فقط در production on-prem. */
  isTampered(): boolean {
    return this.result.status === 'tampered' || this.result.status === 'manifest_invalid' || (this.result.status === 'manifest_missing' && process.env.NODE_ENV === 'production');
  }
}
