import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { KeyObject } from 'node:crypto';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { MOODIAN_CLIENT_FACTORY, type MoodianClient, type MoodianClientConfig, type MoodianClientFactory } from './client/moodian-client.js';
import { assertAllowedBaseUrl } from './client/http-moodian.client.js';
import { SecretsKeyMissingError, decryptSecret, encryptSecret, privateKeyAad } from './crypto/secret-box.js';
import { parseCertificatePem, parsePrivateKeyPem, parseServerPublicKey, sameKeyPair } from './crypto/pem.js';
import { PRODUCTION_BASE_URL } from './mapping/moodian-field-map.js';
import { TaxAuditService } from './tax-audit.service.js';
import type { UpdateTaxSettingsDto, UploadTaxKeyDto } from './dto/tax.dto.js';

const ID = 'default';

export type TaxSettingsRow = {
  id: string;
  economicCode: string | null;
  fiscalId: string | null;
  taxpayerName: string | null;
  postalCode: string | null;
  branchCode: string | null;
  environment: 'SANDBOX' | 'PRODUCTION';
  sendingEnabled: boolean;
  sandboxBaseUrl: string | null;
  defaultVatRate: number | null;
  defaultSstid: string | null;
  defaultUnitCode: number | null;
  privateKeyEnc: string | null;
  keyFingerprint: string | null;
  certificatePem: string | null;
  certFingerprint: string | null;
  certValidTo: Date | null;
  signatureKeyId: string | null;
  serverPublicKeyId: string | null;
  serverPublicKeyPem: string | null;
  serverKeyFetchedAt: Date | null;
  verifiedAgainstSandboxAt: Date | null;
};

/** آنچه به پنل برمی‌گردد: هیچ کلید/PEM خصوصی و هیچ مقدار رمزشده‌ای در آن نیست. */
export type TaxSettingsView = {
  economicCode: string | null;
  fiscalId: string | null;
  taxpayerName: string | null;
  postalCode: string | null;
  branchCode: string | null;
  environment: 'SANDBOX' | 'PRODUCTION';
  sendingEnabled: boolean;
  sandboxBaseUrl: string | null;
  defaultVatRate: number | null;
  defaultSstid: string | null;
  defaultUnitCode: number | null;
  hasPrivateKey: boolean;
  keyFingerprint: string | null;
  hasCertificate: boolean;
  certFingerprint: string | null;
  certValidTo: Date | null;
  signatureKeyId: string | null;
  serverPublicKeyId: string | null;
  serverKeyFetchedAt: Date | null;
  verifiedAgainstSandboxAt: Date | null;
  secretsKeyConfigured: boolean;
  /** «ارسال واقعی غیرفعال است» — بنر پنل */
  realSendingDisabled: boolean;
  readiness: Array<{ key: string; ok: boolean; label: string }>;
};

function isManager(ctx: TenantRequestContext): boolean {
  return ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
}

function defaults(): TaxSettingsRow {
  return {
    id: ID, economicCode: null, fiscalId: null, taxpayerName: null, postalCode: null, branchCode: null, environment: 'SANDBOX', sendingEnabled: false,
    sandboxBaseUrl: null, defaultVatRate: null, defaultSstid: null, defaultUnitCode: null, privateKeyEnc: null, keyFingerprint: null, certificatePem: null,
    certFingerprint: null, certValidTo: null, signatureKeyId: null, serverPublicKeyId: null, serverPublicKeyPem: null, serverKeyFetchedAt: null, verifiedAgainstSandboxAt: null,
  };
}

export function toView(row: TaxSettingsRow, secretsKeyConfigured: boolean): TaxSettingsView {
  const readiness = [
    { key: 'identity', ok: !!row.economicCode && !!row.fiscalId, label: 'شماره اقتصادی و شناسه حافظه مالیاتی' },
    { key: 'privateKey', ok: !!row.privateKeyEnc, label: 'کلید خصوصی بارگذاری شده' },
    { key: 'serverKey', ok: !!row.serverPublicKeyPem, label: 'کلید عمومی سازمان دریافت شده' },
    { key: 'vat', ok: row.defaultVatRate !== null, label: 'نرخ پیش‌فرض ارزش افزوده تعیین شده' },
    { key: 'sandboxVerified', ok: !!row.verifiedAgainstSandboxAt, label: 'یک ارسال موفق در محیط آزمایشی' },
  ];
  return {
    economicCode: row.economicCode, fiscalId: row.fiscalId, taxpayerName: row.taxpayerName, postalCode: row.postalCode, branchCode: row.branchCode,
    environment: row.environment, sendingEnabled: row.sendingEnabled, sandboxBaseUrl: row.sandboxBaseUrl, defaultVatRate: row.defaultVatRate,
    defaultSstid: row.defaultSstid, defaultUnitCode: row.defaultUnitCode, hasPrivateKey: !!row.privateKeyEnc, keyFingerprint: row.keyFingerprint,
    hasCertificate: !!row.certificatePem, certFingerprint: row.certFingerprint, certValidTo: row.certValidTo, signatureKeyId: row.signatureKeyId,
    serverPublicKeyId: row.serverPublicKeyId, serverKeyFetchedAt: row.serverKeyFetchedAt, verifiedAgainstSandboxAt: row.verifiedAgainstSandboxAt,
    secretsKeyConfigured, realSendingDisabled: !row.sendingEnabled || row.environment !== 'PRODUCTION', readiness,
  };
}

function secretsConfigured(): boolean {
  try {
    encryptSecret('x', 'probe');
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class TaxSettingsService {
  constructor(
    @Inject(MOODIAN_CLIENT_FACTORY) private readonly clients: MoodianClientFactory,
    private readonly audit: TaxAuditService,
  ) {}

  private assertManager(ctx: TenantRequestContext, what: string) {
    if (!isManager(ctx)) throw new ForbiddenException(`فقط مالک یا مدیر می‌تواند ${what}`);
  }

  /** مقادیر واقعی (شامل blob رمزشده) — فقط برای مصرف داخلی سرویس‌ها؛ هرگز به کنترلر پاس داده نمی‌شود. */
  async getRow(ctx: TenantRequestContext): Promise<TaxSettingsRow> {
    const row = (await ctx.tenantDb.taxSettings.findUnique({ where: { id: ID } })) as TaxSettingsRow | null;
    return row ?? defaults();
  }

  async getView(ctx: TenantRequestContext): Promise<TaxSettingsView> {
    return toView(await this.getRow(ctx), secretsConfigured());
  }

  private async save(ctx: TenantRequestContext, data: Partial<TaxSettingsRow>): Promise<void> {
    const userId = await resolveTenantUserId(ctx).catch(() => null);
    const { id: _id, ...rest } = data;
    void _id;
    await ctx.tenantDb.taxSettings.upsert({
      where: { id: ID },
      create: { id: ID, ...rest, updatedByUserId: userId ?? undefined },
      update: { ...rest, updatedByUserId: userId ?? undefined },
    });
  }

  async update(ctx: TenantRequestContext, dto: UpdateTaxSettingsDto): Promise<TaxSettingsView> {
    this.assertManager(ctx, 'تنظیمات مالیات را تغییر دهد');
    const cur = await this.getRow(ctx);
    const next: Partial<TaxSettingsRow> = {};
    const str = (v: string | undefined, c: string | null) => (v === undefined ? c : v.trim() === '' ? null : v.trim());
    if (dto.economicCode !== undefined) next.economicCode = str(dto.economicCode, cur.economicCode);
    if (dto.fiscalId !== undefined) next.fiscalId = str(dto.fiscalId, cur.fiscalId)?.toUpperCase() ?? null;
    if (dto.taxpayerName !== undefined) next.taxpayerName = str(dto.taxpayerName, cur.taxpayerName);
    if (dto.postalCode !== undefined) next.postalCode = str(dto.postalCode, cur.postalCode);
    if (dto.branchCode !== undefined) next.branchCode = str(dto.branchCode, cur.branchCode);
    if (dto.sandboxBaseUrl !== undefined) {
      const u = str(dto.sandboxBaseUrl, cur.sandboxBaseUrl);
      if (u) assertAllowedBaseUrl(u);
      next.sandboxBaseUrl = u;
    }
    if (dto.defaultVatRate !== undefined) next.defaultVatRate = dto.defaultVatRate;
    if (dto.defaultSstid !== undefined) next.defaultSstid = str(dto.defaultSstid, cur.defaultSstid);
    if (dto.defaultUnitCode !== undefined) next.defaultUnitCode = dto.defaultUnitCode;

    // هویت مودی عوض شد → تأیید آزمایشی بی‌اعتبار و ارسال خاموش
    const identityChanged = (next.economicCode !== undefined && next.economicCode !== cur.economicCode) || (next.fiscalId !== undefined && next.fiscalId !== cur.fiscalId);
    let environment = dto.environment ?? cur.environment;
    let sendingEnabled = dto.sendingEnabled ?? cur.sendingEnabled;
    let verified = cur.verifiedAgainstSandboxAt;
    if (identityChanged) {
      verified = null;
      sendingEnabled = false;
      if (environment === 'PRODUCTION') environment = 'SANDBOX';
      next.verifiedAgainstSandboxAt = null;
    }
    // سوییچ محیط همیشه ارسال را خاموش می‌کند؛ باید آگاهانه دوباره روشن شود
    if (dto.environment !== undefined && dto.environment !== cur.environment) sendingEnabled = dto.sendingEnabled === true ? sendingEnabled : false;
    if (environment === 'PRODUCTION' && !verified) {
      throw new BadRequestException('محیط واقعی فقط پس از یک ارسال موفق در محیط آزمایشی فعال می‌شود');
    }
    if (sendingEnabled) {
      const merged = { ...cur, ...next };
      if (!merged.privateKeyEnc) throw new BadRequestException('برای فعال‌سازی ارسال ابتدا کلید خصوصی را بارگذاری کنید');
      if (!merged.fiscalId || !merged.economicCode) throw new BadRequestException('برای فعال‌سازی ارسال، شماره اقتصادی و شناسه حافظه مالیاتی لازم است');
      if (!merged.serverPublicKeyPem) throw new BadRequestException('برای فعال‌سازی ارسال ابتدا کلید عمومی سازمان را دریافت کنید');
      if (environment === 'SANDBOX' && !merged.sandboxBaseUrl) throw new BadRequestException('برای ارسال آزمایشی، آدرس محیط آزمایشی را در تنظیمات وارد کنید');
    }
    next.environment = environment;
    next.sendingEnabled = sendingEnabled;
    await this.save(ctx, next);
    await this.audit.activity(ctx, 'tax.settings.updated', null, { fields: Object.keys(dto), environment, sendingEnabled }, 'TaxSettings');
    return this.getView(ctx);
  }

  async uploadKey(ctx: TenantRequestContext, dto: UploadTaxKeyDto): Promise<TaxSettingsView> {
    this.assertManager(ctx, 'کلید مالیاتی را بارگذاری کند');
    const priv = parsePrivateKeyPem(dto.privateKeyPem);
    let cert: ReturnType<typeof parseCertificatePem> | null = null;
    if (dto.certificatePem?.trim()) {
      cert = parseCertificatePem(dto.certificatePem);
      if (!sameKeyPair(priv.key, cert.publicKey)) throw new BadRequestException('گواهی با کلید خصوصی بارگذاری‌شده جفت نیست');
      if (cert.validTo.getTime() < Date.now()) throw new BadRequestException('گواهی منقضی شده است');
    }
    let enc: string;
    try {
      enc = encryptSecret(dto.privateKeyPem.trim(), privateKeyAad(ctx.tenantId));
    } catch (e) {
      if (e instanceof SecretsKeyMissingError) throw new ServiceUnavailableException(e.message);
      throw e;
    }
    await this.save(ctx, {
      privateKeyEnc: enc,
      keyFingerprint: priv.fingerprint,
      certificatePem: cert ? dto.certificatePem!.trim() : null,
      certFingerprint: cert?.fingerprint ?? null,
      certValidTo: cert?.validTo ?? null,
      signatureKeyId: dto.signatureKeyId?.trim() || null,
      // کلید عوض شد: تأیید آزمایشی قبلی معتبر نیست و ارسال خاموش می‌شود
      verifiedAgainstSandboxAt: null,
      sendingEnabled: false,
      environment: 'SANDBOX',
    });
    await this.audit.activity(ctx, 'tax.key.uploaded', null, { fingerprint: priv.fingerprint, hasCertificate: !!cert }, 'TaxSettings');
    return this.getView(ctx);
  }

  async removeKey(ctx: TenantRequestContext): Promise<TaxSettingsView> {
    this.assertManager(ctx, 'کلید مالیاتی را حذف کند');
    await this.save(ctx, { privateKeyEnc: null, keyFingerprint: null, certificatePem: null, certFingerprint: null, certValidTo: null, signatureKeyId: null, sendingEnabled: false, verifiedAgainstSandboxAt: null, environment: 'SANDBOX' });
    await this.audit.activity(ctx, 'tax.key.removed', null, {}, 'TaxSettings');
    return this.getView(ctx);
  }

  resolveBaseUrl(row: Pick<TaxSettingsRow, 'environment' | 'sandboxBaseUrl'>): string {
    if (row.environment === 'PRODUCTION') return PRODUCTION_BASE_URL;
    if (!row.sandboxBaseUrl) throw new BadRequestException('آدرس محیط آزمایشی تنظیم نشده است (هرگز به محیط واقعی تغییر مسیر داده نمی‌شود)');
    return row.sandboxBaseUrl;
  }

  /** برای کلاینت: کلید خصوصی را فقط در حافظه رمزگشایی می‌کند. */
  async buildClient(ctx: TenantRequestContext, taxInvoiceId: string | null = null, rowIn?: TaxSettingsRow): Promise<{ client: MoodianClient; row: TaxSettingsRow }> {
    const row = rowIn ?? (await this.getRow(ctx));
    let privateKey: KeyObject | null = null;
    if (row.privateKeyEnc) {
      try {
        privateKey = parsePrivateKeyPem(decryptSecret(row.privateKeyEnc, privateKeyAad(ctx.tenantId))).key;
      } catch (e) {
        if (e instanceof SecretsKeyMissingError) throw new ServiceUnavailableException(e.message);
        throw new ServiceUnavailableException('کلید خصوصی ذخیره‌شده قابل بازگشایی نیست؛ دوباره بارگذاری کنید');
      }
    }
    const config: MoodianClientConfig = {
      settings: { fiscalId: row.fiscalId, environment: row.environment, sendingEnabled: row.sendingEnabled, verifiedAgainstSandboxAt: row.verifiedAgainstSandboxAt },
      baseUrl: this.resolveBaseUrl(row),
      privateKey,
      serverPublicKey: row.serverPublicKeyPem ? parseServerPublicKey(row.serverPublicKeyPem) : null,
      serverPublicKeyId: row.serverPublicKeyId,
      signatureKeyId: row.signatureKeyId,
      onLog: (entry) => void this.audit.submission(ctx, taxInvoiceId, entry),
    };
    return { client: this.clients.create(config), row };
  }

  /** دریافت و ذخیره‌ی کلید عمومی سازمان (purpose=1). فقط خواندنی؛ نیازی به sendingEnabled ندارد. */
  async refreshServerKey(ctx: TenantRequestContext): Promise<TaxSettingsView> {
    this.assertManager(ctx, 'کلید سرور را دریافت کند');
    const { client } = await this.buildClient(ctx);
    const info = await client.getServerInformation();
    const key = info.publicKeys?.find((k) => k.purpose === 1) ?? info.publicKeys?.[0];
    if (!key) throw new BadRequestException('سامانه مودیان کلید عمومی برنگرداند');
    parseServerPublicKey(key.key); // اعتبارسنجی ساختاری
    await this.save(ctx, { serverPublicKeyId: key.id, serverPublicKeyPem: key.key, serverKeyFetchedAt: new Date() });
    await this.audit.activity(ctx, 'tax.serverKey.refreshed', null, { keyId: key.id }, 'TaxSettings');
    return this.getView(ctx);
  }

  /** پس از اولین پذیرش در محیط آزمایشی صدا زده می‌شود. */
  async markSandboxVerified(ctx: TenantRequestContext): Promise<void> {
    const row = await this.getRow(ctx);
    if (row.verifiedAgainstSandboxAt) return;
    await this.save(ctx, { verifiedAgainstSandboxAt: new Date() });
    await this.audit.activity(ctx, 'tax.sandbox.verified', null, {}, 'TaxSettings');
  }
}
