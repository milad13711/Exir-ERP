import { Injectable } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { LicenseAuditService } from './license-audit.service.js';
import { LicenseSettingsService } from './license-settings.service.js';
import { LicenseSigningService } from './license-signing.service.js';
import { effectiveStatus, normalizeIdentifier, normalizeLicenseKey } from './license-key.js';
import { fingerprintMatches, licenseKeyHash, sha256Hex } from './license-crypto.js';

export type PublicAction = 'verify' | 'activate' | 'deactivate' | 'checkin';

export const PUBLIC_CODES = {
  valid: { success: true, http: 200, message: 'License is valid.' },
  activated: { success: true, http: 200, message: 'License activated.' },
  already_activated: { success: true, http: 200, message: 'License is already activated for this identifier.' },
  deactivated: { success: true, http: 200, message: 'Activation removed.' },
  missing_license_key: { success: false, http: 400, message: 'License key is missing or malformed.' },
  missing_identifier: { success: false, http: 400, message: 'Identifier is required.' },
  license_not_found: { success: false, http: 404, message: 'License not found.' },
  license_suspended: { success: false, http: 403, message: 'License is suspended.' },
  license_revoked: { success: false, http: 403, message: 'License is revoked.' },
  license_expired: { success: false, http: 403, message: 'License has expired.' },
  not_activated: { success: false, http: 403, message: 'License is not activated for this identifier.' },
  activation_limit_reached: { success: false, http: 403, message: 'Activation limit reached.' },
  fingerprint_mismatch: { success: false, http: 403, message: 'Installation fingerprint does not match; re-activate this installation.' },
  api_disabled: { success: false, http: 503, message: 'License API is disabled.' },
  server_misconfigured: { success: false, http: 503, message: 'License server is not configured.' },
  rate_limited: { success: false, http: 429, message: 'Too many requests.' },
} as const;
export type PublicCode = keyof typeof PUBLIC_CODES;

export type PublicRequest = {
  action: PublicAction;
  licenseKey: unknown;
  identifier: unknown;
  fingerprint?: unknown;
  nonce?: unknown;
  telemetry?: unknown;
  ip: string;
};

export type PublicBody = {
  success: boolean;
  code: PublicCode;
  message: string;
  license_key: string;
  identifier: string;
  timestamp: number;
  nonce: string;
  kid: string;
  data: null | {
    product_name: string;
    edition: string | null;
    status: string;
    expires_at: string | null;
    updates_until: string | null;
    activations: number;
    max_activations: number;
  };
  token?: string;
  crl?: string;
  signature: string;
};

type LicenseRow = NonNullable<Awaited<ReturnType<ControlPrismaService['license']['findFirst']>>>;

const FP_RE = /^[a-f0-9]{16,64}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function sanitizeFingerprint(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 8) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || !FP_RE.test(v)) return null;
    out.push(v);
  }
  return out;
}

export function sanitizeTelemetry(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.floor(v) : undefined);
  const tam = (t.tamper && typeof t.tamper === 'object' ? t.tamper : {}) as Record<string, unknown>;
  // فقط شمارنده‌ها و وضعیت‌ها — هیچ داده‌ی شخصی/کسب‌وکاری پذیرفته نمی‌شود.
  return {
    appVersion: str(t.appVersion, 32),
    runtimeState: str(t.runtimeState, 32),
    users: int(t.users),
    modules: int(t.modules),
    clockRollback: t.clockRollback === true ? true : undefined,
    tamper: { status: str(tam.status, 32), modified: int(tam.modified), added: int(tam.added), missing: int(tam.missing) },
  };
}

/**
 * منطق API عمومی لایسنس (verify / activate / deactivate / checkin). بدون وابستگی به HTTP تا قابل تست باشد.
 * خروجی همیشه با یک شکل ثابت و امضای Ed25519؛ هیچ داده‌ی شخصی مشتری در پاسخ نمی‌آید.
 */
@Injectable()
export class LicensePublicService {
  private crlCache: { at: number; version: number; token: string | null } | null = null;

  constructor(
    private readonly db: ControlPrismaService,
    private readonly settings: LicenseSettingsService,
    private readonly signer: LicenseSigningService,
    private readonly audit: LicenseAuditService,
  ) {}

  /** پاسخ امضاشده‌ی بدون پردازش (مثلاً rate_limited). */
  async reject(req: PublicRequest, code: PublicCode): Promise<{ http: number; body: PublicBody }> {
    const key = normalizeLicenseKey(req.licenseKey) ?? '';
    const nonce = typeof req.nonce === 'string' && NONCE_RE.test(req.nonce) ? req.nonce : '';
    const body = await this.finish(req, code, key, normalizeIdentifier(req.identifier), nonce, {});
    return { http: PUBLIC_CODES[code].http, body };
  }

  async handle(req: PublicRequest): Promise<{ http: number; body: PublicBody }> {
    const body = await this.run(req);
    return { http: PUBLIC_CODES[body.code].http, body };
  }

  private async run(req: PublicRequest): Promise<PublicBody> {
    const key = normalizeLicenseKey(req.licenseKey);
    const identifier = normalizeIdentifier(req.identifier);
    const nonce = typeof req.nonce === 'string' && NONCE_RE.test(req.nonce) ? req.nonce : '';
    const rawKey = typeof req.licenseKey === 'string' ? req.licenseKey.trim().slice(0, 64) : '';
    const finish = (code: PublicCode, extra: { license?: LicenseRow; data?: PublicBody['data']; token?: string; crl?: string } = {}) =>
      this.finish(req, code, key ?? rawKey, identifier, nonce, extra);

    const st = await this.settings.get();
    if (!st.apiEnabled) return finish('api_disabled');
    if (!this.signer.isConfigured()) return finish('server_misconfigured');
    if (!key) return finish('missing_license_key');

    const license = await this.db.license.findFirst({ where: { licenseKey: key, deletedAt: null } });
    if (!license) return finish('license_not_found');

    const fingerprint = sanitizeFingerprint(req.fingerprint);

    if (req.action === 'deactivate') {
      if (!identifier) return finish('missing_identifier', { license });
      // آزادسازی توسط خود کلاینت ظرفیت را فوری آزاد نمی‌کند: توکن صادرشده تا (اعتبار توکن + graceDays) آفلاین کار می‌کند، پس
      // اسلات تا آن زمان «اشغال» می‌ماند (ضد چرخه‌ی activate/deactivate روی چند ماشین). آزادسازی فوری فقط مسیر ادمین است.
      const res = await this.db.licenseActivation.updateMany({
        where: { licenseId: license.id, identifier, deletedAt: null },
        data: { deletedAt: new Date(), releasedBy: 'client' },
      });
      const data = await this.dataFor(license);
      return finish(res.count > 0 ? 'deactivated' : 'not_activated', { license, data });
    }

    const eff = effectiveStatus(license);
    if (eff === 'suspended') return finish('license_suspended', { license });
    if (eff === 'revoked') return finish('license_revoked', { license });
    if (eff === 'expired') return finish('license_expired', { license });

    if (req.action === 'activate') {
      if (!identifier) return finish('missing_identifier', { license });
      const r = await this.activate(license, identifier, fingerprint, req);
      if (r.kind === 'limit') return finish('activation_limit_reached', { license, data: await this.dataFor(license) });
      if (r.kind === 'gone') return finish('license_not_found');
      if (r.kind === 'blocked') return finish(r.code, { license });
      if (r.kind === 'mismatch') return finish('fingerprint_mismatch', { license, data: await this.dataFor(license) });
      return finish(r.kind === 'already' ? 'already_activated' : 'activated', {
        license,
        data: await this.dataFor(license),
        token: await this.issueToken(license, identifier, r.fingerprint, nonce, st),
      });
    }

    // verify / checkin
    if (!identifier) {
      if (req.action === 'checkin') return finish('missing_identifier', { license });
      return finish('valid', { license, data: await this.dataFor(license) });
    }
    const act = await this.db.licenseActivation.findFirst({ where: { licenseId: license.id, identifier, deletedAt: null } });
    if (!act) return finish('not_activated', { license, data: await this.dataFor(license) });
    const storedFp = Array.isArray(act.fingerprint) ? (act.fingerprint as string[]) : [];
    if (storedFp.length > 0 && (!fingerprint || !fingerprintMatches(storedFp, fingerprint))) {
      return finish('fingerprint_mismatch', { license, data: await this.dataFor(license) });
    }
    const telemetry = req.action === 'checkin' ? sanitizeTelemetry(req.telemetry) : null;
    const tamper = telemetry ? ((telemetry.tamper as { status?: string } | undefined)?.status ?? null) : null;
    await this.db.licenseActivation.update({
      where: { id: act.id },
      data: {
        lastCheckAt: new Date(),
        ip: req.ip,
        lastTokenAt: new Date(),
        ...(telemetry
          ? { lastTelemetry: telemetry as never, appVersion: (telemetry.appVersion as string | undefined) ?? act.appVersion, tamperStatus: tamper }
          : {}),
      },
    });
    if (req.action === 'checkin') {
      await this.db.license.update({
        where: { id: license.id },
        data: {
          lastCheckInAt: new Date(),
          lastCheckInIp: req.ip,
          ...(telemetry
            ? { lastAppVersion: (telemetry.appVersion as string | undefined) ?? license.lastAppVersion, lastTamperStatus: tamper, lastTelemetry: telemetry as never }
            : {}),
        },
      });
    }
    return finish('valid', {
      license,
      data: await this.dataFor(license),
      token: await this.issueToken(license, identifier, storedFp.length ? storedFp : fingerprint, nonce, st),
      crl: req.action === 'checkin' ? ((await this.currentCrl(st.crlVersion)) ?? undefined) : undefined,
    });
  }

  private async activate(license: LicenseRow, identifier: string, fingerprint: string[] | null, req: PublicRequest) {
    return this.db.$transaction(async (tx) => {
      // قفل ردیف لایسنس: شمارش سقف و درج، اتمیک (دو activate هم‌زمان از سقف عبور نمی‌کنند)
      await tx.$queryRaw`SELECT "id" FROM "licenses" WHERE "id" = ${license.id} FOR UPDATE`;
      const fresh = await tx.license.findFirst({ where: { id: license.id, deletedAt: null } });
      if (!fresh) return { kind: 'gone' as const };
      const eff = effectiveStatus(fresh);
      if (eff === 'suspended') return { kind: 'blocked' as const, code: 'license_suspended' as const };
      if (eff === 'revoked') return { kind: 'blocked' as const, code: 'license_revoked' as const };
      if (eff === 'expired') return { kind: 'blocked' as const, code: 'license_expired' as const };

      const existing = await tx.licenseActivation.findFirst({ where: { licenseId: fresh.id, identifier, deletedAt: null } });
      if (existing) {
        const storedFp = Array.isArray(existing.fingerprint) ? (existing.fingerprint as string[]) : [];
        if (storedFp.length > 0 && (!fingerprint || !fingerprintMatches(storedFp, fingerprint))) return { kind: 'mismatch' as const };
        await tx.licenseActivation.update({ where: { id: existing.id }, data: { lastCheckAt: new Date(), ip: req.ip } });
        return { kind: 'already' as const, fingerprint: storedFp.length ? storedFp : fingerprint };
      }
      const st = await this.settings.get();
      const holdMs = (st.tokenValidityDays + fresh.graceDays) * 86_400_000;
      // اسلات‌های آزادشده توسط کلاینت تا پایان اعتبار توکنِ آخر (+grace) هنوز اشغال‌اند (به‌جز همین شناسه)
      const held = await tx.licenseActivation.findFirst({
        where: { licenseId: fresh.id, identifier, releasedBy: 'client', deletedAt: { not: null }, lastTokenAt: { gte: new Date(Date.now() - holdMs) } },
      });
      const count = await tx.licenseActivation.count({ where: { licenseId: fresh.id, deletedAt: null } });
      const heldOthers = await tx.licenseActivation.count({
        where: { licenseId: fresh.id, releasedBy: 'client', deletedAt: { not: null }, lastTokenAt: { gte: new Date(Date.now() - holdMs) }, identifier: { not: identifier } },
      });
      if (fresh.maxActivations > 0 && count + heldOthers >= fresh.maxActivations) return { kind: 'limit' as const };
      if (held) {
        // همان نصب دوباره فعال می‌شود: ردیف نگه‌داشته‌شده احیا می‌شود (ردیف تکراری نمی‌سازد)
        await tx.licenseActivation.update({ where: { id: held.id }, data: { deletedAt: null, releasedBy: null, lastCheckAt: new Date(), lastTokenAt: new Date(), ip: req.ip } });
        const storedFp = Array.isArray(held.fingerprint) ? (held.fingerprint as string[]) : [];
        return { kind: 'created' as const, fingerprint: storedFp.length ? storedFp : fingerprint };
      }
      await tx.licenseActivation.create({
        data: { licenseId: fresh.id, identifier, ip: req.ip, fingerprint: (fingerprint ?? undefined) as never, lastTokenAt: new Date() },
      });
      return { kind: 'created' as const, fingerprint };
    });
  }

  private async issueToken(
    license: LicenseRow,
    identifier: string,
    fingerprint: string[] | null,
    nonce: string,
    st: { tokenValidityDays: number; crlVersion: number },
  ): Promise<string> {
    return this.signer.buildToken({
      license: { ...license, licenseKey: license.licenseKey as string },
      installationId: identifier,
      fingerprint,
      nonce: nonce || null,
      validityDays: st.tokenValidityDays,
      crlVersion: st.crlVersion,
    }).token;
  }

  private async dataFor(license: LicenseRow): Promise<PublicBody['data']> {
    const activations = await this.db.licenseActivation.count({ where: { licenseId: license.id, deletedAt: null } });
    return {
      product_name: license.productName,
      edition: license.edition,
      status: effectiveStatus(license),
      expires_at: license.expiresAt ? license.expiresAt.toISOString() : null,
      updates_until: license.updatesUntil ? license.updatesUntil.toISOString() : null,
      activations,
      max_activations: license.maxActivations,
    };
  }

  /** CRL امضاشده (کش ۳۰ ثانیه‌ای، نسخه‌دار). */
  async currentCrl(version?: number): Promise<string | null> {
    const v = version ?? (await this.settings.get()).crlVersion;
    const now = Date.now();
    if (this.crlCache && this.crlCache.version === v && now - this.crlCache.at < 30_000) return this.crlCache.token;
    const rows = await this.db.license.findMany({
      where: { OR: [{ status: { in: ['REVOKED', 'SUSPENDED'] } }, { deletedAt: { not: null } }], licenseKey: { not: null } },
      select: { licenseKey: true },
    });
    const token = this.signer.signCrl({
      version: v,
      issuedAt: new Date().toISOString(),
      revoked: rows.map((r) => licenseKeyHash(r.licenseKey as string)),
      revokedKids: (process.env.LICENSE_REVOKED_KIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    });
    this.crlCache = { at: now, version: v, token };
    return token;
  }

  private async finish(
    req: PublicRequest,
    code: PublicCode,
    licenseKey: string,
    identifier: string,
    nonce: string,
    extra: { license?: LicenseRow; data?: PublicBody['data']; token?: string; crl?: string },
  ): Promise<PublicBody> {
    const def = PUBLIC_CODES[code];
    const timestamp = Math.floor(Date.now() / 1000);
    const crlHash = def.success && extra.crl ? sha256Hex(extra.crl) : '';
    const sig = this.signer.signResponse({ success: def.success, code, license_key: licenseKey, identifier, timestamp, nonce, crlHash });
    const body: PublicBody = {
      success: def.success,
      code,
      message: def.message,
      license_key: licenseKey,
      identifier,
      timestamp,
      nonce,
      kid: sig.kid,
      data: def.success || extra.license ? (extra.data ?? null) : null,
      ...(def.success && extra.token ? { token: extra.token } : {}),
      ...(def.success && extra.crl ? { crl: extra.crl } : {}),
      signature: sig.signature,
    };
    // لاگ: همه‌ی شکست‌ها و تغییرات؛ verify/check-in موفق نمونه‌برداری می‌شود.
    const routine = (code === 'valid') && (req.action === 'verify' || req.action === 'checkin');
    let log = !routine && code !== 'rate_limited'; // rate_limited هرگز در DB نوشته نمی‌شود (حمله‌ی سیل → سیل نوشتن)
    if (routine) log = this.audit.shouldSample((await this.settings.get()).auditSampleEvery);
    if (log) {
      await this.audit.record({
        kind: req.action === 'checkin' ? 'CHECKIN' : 'PUBLIC',
        action: req.action,
        licenseId: extra.license?.id ?? null,
        licenseKey: licenseKey || null,
        code,
        ip: req.ip,
        detail: identifier ? { identifier: identifier.slice(0, 64) } : undefined,
      });
    }
    return body;
  }
}
