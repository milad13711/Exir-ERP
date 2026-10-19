import { Injectable } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

export type LicenseSettings = {
  apiEnabled: boolean;
  tokenValidityDays: number;
  /** نمونه‌برداری لاگ پاسخ‌های موفق verify/check-in: 1 از N (۱ = همه) */
  auditSampleEvery: number;
  crlVersion: number;
};

const DEFAULTS: LicenseSettings = { apiEnabled: true, tokenValidityDays: 14, auditSampleEvery: 20, crlVersion: 1 };
const CACHE_MS = 5_000;

/** تنظیمات key/value سیستم لایسنس (جدول license_settings). فقط مقادیر غیرمحرمانه. */
@Injectable()
export class LicenseSettingsService {
  private cache: { at: number; value: LicenseSettings } | null = null;

  constructor(private readonly db: ControlPrismaService) {}

  async get(): Promise<LicenseSettings> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_MS) return this.cache.value;
    const rows = await this.db.licenseSetting.findMany();
    const m = new Map(rows.map((r) => [r.key, r.value]));
    const num = (k: string, d: number, min: number, max: number) => {
      const n = Number(m.get(k));
      return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : d;
    };
    const value: LicenseSettings = {
      apiEnabled: m.has('api_enabled') ? m.get('api_enabled') === 'true' : DEFAULTS.apiEnabled,
      tokenValidityDays: num('token_validity_days', Number(process.env.LICENSE_TOKEN_VALIDITY_DAYS) || DEFAULTS.tokenValidityDays, 1, 3650),
      auditSampleEvery: num('audit_sample_every', DEFAULTS.auditSampleEvery, 1, 100000),
      crlVersion: num('crl_version', DEFAULTS.crlVersion, 1, 2_000_000_000),
    };
    this.cache = { at: now, value };
    return value;
  }

  async set(patch: Partial<Pick<LicenseSettings, 'apiEnabled' | 'tokenValidityDays' | 'auditSampleEvery'>>): Promise<LicenseSettings> {
    const entries: [string, string][] = [];
    if (patch.apiEnabled !== undefined) entries.push(['api_enabled', String(patch.apiEnabled)]);
    if (patch.tokenValidityDays !== undefined) entries.push(['token_validity_days', String(patch.tokenValidityDays)]);
    if (patch.auditSampleEvery !== undefined) entries.push(['audit_sample_every', String(patch.auditSampleEvery)]);
    for (const [key, value] of entries) {
      await this.db.licenseSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    this.cache = null;
    return this.get();
  }

  /** پس از هر تغییر وضعیت لغو/تعلیق/حذف (CRL) صدا زده می‌شود. اتمیک (UPDATE…RETURNING)؛ می‌تواند داخل تراکنش فراخواننده اجرا شود. */
  async bumpCrl(tx: Pick<ControlPrismaService, '$queryRaw'> = this.db): Promise<number> {
    const rows = await tx.$queryRaw<{ value: string }[]>`
      INSERT INTO "license_settings" ("key", "value", "updatedAt") VALUES ('crl_version', '2', now())
      ON CONFLICT ("key") DO UPDATE SET "value" = (CASE WHEN "license_settings"."value" ~ '^[0-9]+$' THEN ("license_settings"."value"::bigint + 1)::text ELSE '2' END), "updatedAt" = now()
      RETURNING "value"`;
    this.cache = null;
    return Number(rows[0]?.value ?? 0);
  }
}
