import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { LicenseAuditService } from './license-audit.service.js';
import { LicenseSettingsService } from './license-settings.service.js';
import { LicenseSigningService } from './license-signing.service.js';
import { effectiveStatus, generateUniqueLicenseKey, type EffectiveStatus } from './license-key.js';
import { OfflineTokenError, issueOfflineTokenCore } from './license-offline.js';
import type { License } from '../../generated/control-client/index.js';
import type { LicenseEventInput } from './license-audit.service.js';
import type {
  CreateLicenseAdminDto,
  LicenseSettingsDto,
  ListEventsQuery,
  ListLicensesQuery,
  OfflineTokenDto,
  RenewLicenseDto,
  UpdateLicenseAdminDto,
} from './license-admin.dto.js';

export type Actor = { id: string; label: string; ip?: string };

/** «تا پایان همان روز به وقت تهران (UTC+03:30)» — ورودی تاریخ‌-فقط؛ ISO کامل بدون تغییر. */
export function parseExpiry(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T23:59:59+03:30`);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
    return d;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('تاریخ نامعتبر است');
  return d;
}

/** خنثی‌سازی CSV/formula injection (= + - @ tab CR) + quoting. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

@Injectable()
export class LicenseAdminService implements OnModuleInit {
  private readonly logger = new Logger('LicenseAdmin');

  constructor(
    private readonly db: ControlPrismaService,
    private readonly audit: LicenseAuditService,
    private readonly settings: LicenseSettingsService,
    private readonly signer: LicenseSigningService,
  ) {}

  /** ردیف‌های قدیمی (قبل از سیستم v2) کلید LIC-... ندارند؛ با CSPRNG پر می‌شوند. ایدمپوتنت. */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.db.license.findMany({ where: { licenseKey: null }, select: { id: true } });
      for (const r of rows) {
        const key = await generateUniqueLicenseKey(async (k) => !!(await this.db.license.findUnique({ where: { licenseKey: k }, select: { id: true } })));
        await this.db.license.update({ where: { id: r.id }, data: { licenseKey: key } });
        await this.audit.record({ kind: 'SYSTEM', action: 'backfill_key', licenseId: r.id, licenseKey: key });
      }
      if (rows.length) this.logger.log(`backfilled licenseKey for ${rows.length} legacy license(s)`);
    } catch (err) {
      this.logger.warn(`license key backfill skipped: ${(err as Error).message}`);
    }
  }

  // ── خواندن ───────────────────────────────────────────────────────────

  private view<T extends { status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'; expiresAt: Date | null; signedKey?: string | null }>(l: T) {
    const { signedKey, ...rest } = l as T & { signedKey?: string | null };
    return { ...rest, hasOfflineToken: !!signedKey, effectiveStatus: effectiveStatus(l) as EffectiveStatus };
  }

  private buildWhere(q: ListLicensesQuery) {
    const now = new Date();
    const where: Record<string, unknown> = {};
    if (q.includeDeleted !== 'true') where.deletedAt = null;
    if (q.product) where.productName = q.product;
    const and: unknown[] = [];
    if (q.q?.trim()) {
      const term = q.q.trim();
      and.push({
        OR: [
          { licenseKey: { contains: term.toUpperCase() } },
          { orgName: { contains: term, mode: 'insensitive' } },
          { customerName: { contains: term, mode: 'insensitive' } },
          { customerEmail: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    const wanted = (q.status ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (wanted.length) {
      const ors: unknown[] = [];
      if (wanted.includes('active')) ors.push({ status: 'ACTIVE', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] });
      if (wanted.includes('expired')) ors.push({ status: 'ACTIVE', expiresAt: { lt: now } });
      if (wanted.includes('suspended')) ors.push({ status: 'SUSPENDED' });
      if (wanted.includes('revoked')) ors.push({ status: 'REVOKED' });
      if (ors.length) and.push({ OR: ors });
    }
    if (and.length) where.AND = and;
    return where;
  }

  async list(q: ListLicensesQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where = this.buildWhere(q) as never;
    const [total, rows] = await Promise.all([
      this.db.license.count({ where }),
      this.db.license.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { tenant: { select: { id: true, name: true, slug: true } }, _count: { select: { activations: { where: { deletedAt: null } } } } },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map(({ _count, ...l }) => ({ ...this.view(l), activationCount: _count.activations })),
    };
  }

  async get(id: string) {
    const l = await this.db.license.findFirst({
      where: { id },
      include: { tenant: { select: { id: true, name: true, slug: true } }, _count: { select: { activations: { where: { deletedAt: null } } } } },
    });
    if (!l) throw new NotFoundException('لایسنس یافت نشد');
    const { _count, ...rest } = l;
    return { ...this.view(rest), activationCount: _count.activations };
  }

  async exportCsv(q: ListLicensesQuery): Promise<string> {
    const rows = await this.db.license.findMany({
      where: this.buildWhere(q) as never,
      orderBy: { issuedAt: 'desc' },
      take: 20000,
      include: { _count: { select: { activations: { where: { deletedAt: null } } } } },
    });
    const head = ['licenseKey', 'product', 'edition', 'org', 'customer', 'status', 'effectiveStatus', 'activations', 'maxActivations', 'seats', 'expiresAt', 'updatesUntil', 'issuedAt', 'lastCheckInAt', 'lastAppVersion', 'tamper'];
    const lines = [head.map(csvCell).join(',')];
    for (const r of rows) {
      lines.push(
        [r.licenseKey, r.productName, r.edition, r.orgName, r.customerName, r.status, effectiveStatus(r), r._count.activations, r.maxActivations, r.seats, r.expiresAt, r.updatesUntil, r.issuedAt, r.lastCheckInAt, r.lastAppVersion, r.lastTamperStatus]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\r\n');
  }

  // ── نوشتن ────────────────────────────────────────────────────────────

  /** ماژول‌ها را اعتبارسنجی و وابستگی‌های (transitive) آن‌ها را اضافه می‌کند — تا ماژول لایسنس‌شده بدون وابستگی‌اش بی‌کار نماند. */
  async expandModules(codes: string[]): Promise<string[]> {
    const defs = await this.db.moduleDefinition.findMany({ select: { code: true, dependsOn: true } });
    const byCode = new Map(defs.map((d) => [d.code, d]));
    const unknown = codes.filter((c) => !byCode.has(c));
    if (unknown.length) throw new BadRequestException(`ماژول ناشناخته: ${unknown.join(', ')}`);
    const out = new Set<string>();
    const queue = [...codes];
    while (queue.length) {
      const c = queue.shift()!;
      if (out.has(c)) continue;
      out.add(c);
      queue.push(...(byCode.get(c)?.dependsOn ?? []));
    }
    return [...out].sort();
  }

  /** mutation + ردپا در یک تراکنش: بدون ردپا هیچ تغییری ماندگار نمی‌شود. */
  private async mutate(fn: (tx: any) => Promise<any>, ev: (r: License) => LicenseEventInput): Promise<License> {
    return this.db.$transaction(async (tx) => {
      const r = await fn(tx);
      await tx.licenseEvent.create({ data: this.audit.rowOf(ev(r)) });
      return r;
    });
  }

  private async assertTenant(tenantId?: string | null): Promise<void> {
    if (!tenantId) return;
    const t = await this.db.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!t) throw new BadRequestException('تننت یافت نشد');
  }

  async create(dto: CreateLicenseAdminDto, actor: Actor) {
    if (dto.modules.length === 0) throw new BadRequestException('حداقل یک ماژول لازم است');
    await this.assertTenant(dto.tenantId);
    const modules = await this.expandModules(dto.modules);
    let expiresAt: Date | null = null;
    if (dto.expiresAt) expiresAt = parseExpiry(dto.expiresAt);
    else if (dto.validityDays) expiresAt = new Date(Date.now() + dto.validityDays * 86_400_000);
    const licenseKey = await generateUniqueLicenseKey(async (k) => !!(await this.db.license.findUnique({ where: { licenseKey: k }, select: { id: true } })));
    const created = await this.mutate(
      (tx) =>
        tx.license.create({
          data: {
            licenseKey,
            orgName: dto.orgName.trim(),
            productName: dto.productName?.trim() || 'exir-erp',
            edition: dto.edition?.trim() || null,
            customerName: dto.customerName?.trim() || null,
            customerEmail: dto.customerEmail?.trim() || null,
            notes: dto.notes ?? null,
            tenantId: dto.tenantId ?? null,
            allowedModules: modules,
            seats: dto.seats ?? 10,
            maxActivations: dto.maxActivations ?? 1,
            expiresAt,
            updatesUntil: dto.updatesUntil ? parseExpiry(dto.updatesUntil) : null,
            // مهلت اضافه‌ی پیش‌فرض کوتاه (۷ روز)؛ برای هر لایسنس قابل‌تنظیم است
            graceDays: dto.graceDays ?? 7,
            integrityPolicy: dto.integrityPolicy ?? 'WARN',
            issuedByAdminId: actor.id,
          },
        }),
      (l) => ({ kind: 'ADMIN', action: 'create', licenseId: l.id, licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { orgName: l.orgName, modules: modules.length, perpetual: !expiresAt } }),
    );
    return this.view(created);
  }

  private async mustGet(id: string) {
    const l = await this.db.license.findFirst({ where: { id, deletedAt: null } });
    if (!l) throw new NotFoundException('لایسنس یافت نشد');
    return l;
  }

  async update(id: string, dto: UpdateLicenseAdminDto, actor: Actor) {
    const before = await this.mustGet(id);
    await this.assertTenant(dto.tenantId);
    const data: Record<string, unknown> = {};
    for (const k of ['orgName', 'productName', 'edition', 'customerName', 'customerEmail', 'notes', 'tenantId', 'seats', 'maxActivations', 'graceDays', 'integrityPolicy'] as const) {
      if (dto[k] !== undefined) data[k] = typeof dto[k] === 'string' ? (dto[k] as string).trim() || null : dto[k];
    }
    if (dto.orgName !== undefined) data.orgName = dto.orgName.trim();
    if (dto.modules) data.allowedModules = await this.expandModules(dto.modules);
    const updated = await this.mutate(
      (tx) => tx.license.update({ where: { id }, data }),
      () => ({ kind: 'ADMIN', action: 'update', licenseId: id, licenseKey: before.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { fields: Object.keys(data) } }),
    );
    return this.view(updated);
  }

  async renew(id: string, dto: RenewLicenseDto, actor: Actor) {
    const before = await this.mustGet(id);
    const data: Record<string, unknown> = {};
    if (dto.perpetual) data.expiresAt = null;
    else if (dto.expiresAt) data.expiresAt = parseExpiry(dto.expiresAt);
    else if (dto.extendDays) {
      const base = before.expiresAt && before.expiresAt.getTime() > Date.now() ? before.expiresAt.getTime() : Date.now();
      data.expiresAt = new Date(base + dto.extendDays * 86_400_000);
    }
    if (dto.updatesUnlimited) data.updatesUntil = null;
    else if (dto.updatesUntil) data.updatesUntil = parseExpiry(dto.updatesUntil);
    if (Object.keys(data).length === 0) throw new BadRequestException('هیچ تغییری مشخص نشده است');
    const updated = await this.mutate(
      (tx) => tx.license.update({ where: { id }, data }),
      () => ({ kind: 'ADMIN', action: 'renew', licenseId: id, licenseKey: before.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { from: before.expiresAt?.toISOString() ?? null, to: (data.expiresAt as Date | null | undefined)?.toISOString?.() ?? null, updatesUntil: (data.updatesUntil as Date | null | undefined)?.toISOString?.() ?? null } }),
    );
    return this.view(updated);
  }

  async suspend(id: string, reason: string, actor: Actor) {
    const before = await this.mustGet(id);
    if (before.status === 'REVOKED') throw new BadRequestException('لایسنس لغو‌شده را نمی‌توان معلق کرد');
    const updated = await this.mutate(
      async (tx) => {
        const l = await tx.license.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedReason: reason } });
        await this.settings.bumpCrl(tx);
        return l;
      },
      () => ({ kind: 'ADMIN', action: 'suspend', licenseId: id, licenseKey: before.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { reason } }),
    );
    return this.view(updated);
  }

  async resume(id: string, actor: Actor) {
    const before = await this.mustGet(id);
    if (before.status !== 'SUSPENDED') throw new BadRequestException('فقط لایسنس معلق قابل ازسرگیری است');
    const updated = await this.mutate(
      async (tx) => {
        const l = await tx.license.update({ where: { id }, data: { status: 'ACTIVE', suspendedAt: null, suspendedReason: null } });
        await this.settings.bumpCrl(tx);
        return l;
      },
      () => ({ kind: 'ADMIN', action: 'resume', licenseId: id, licenseKey: before.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip }),
    );
    return this.view(updated);
  }

  async revoke(id: string, reason: string, actor: Actor) {
    const before = await this.mustGet(id);
    const updated = await this.mutate(
      async (tx) => {
        const l = await tx.license.update({ where: { id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason } });
        await this.settings.bumpCrl(tx);
        return l;
      },
      () => ({ kind: 'ADMIN', action: 'revoke', licenseId: id, licenseKey: before.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { reason } }),
    );
    return this.view(updated);
  }

  async softDelete(id: string, reason: string, actor: Actor) {
    const before = await this.mustGet(id);
    await this.mutate(
      async (tx) => {
        await tx.license.update({ where: { id }, data: { deletedAt: new Date() } });
        await this.settings.bumpCrl(tx);
        return true;
      },
      () => ({ kind: 'ADMIN', action: 'delete', licenseId: id, licenseKey: before.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { reason } }),
    );
    return { ok: true };
  }

  // ── فعال‌سازی‌ها ──────────────────────────────────────────────────────

  async listActivations(id: string) {
    await this.get(id);
    return this.db.licenseActivation.findMany({
      where: { licenseId: id, deletedAt: null },
      orderBy: { activatedAt: 'desc' },
      select: { id: true, identifier: true, ip: true, appVersion: true, tamperStatus: true, lastTelemetry: true, activatedAt: true, lastCheckAt: true },
    });
  }

  /** آزادسازی ادمین فوری است (ظرفیت بلافاصله برمی‌گردد؛ برخلاف deactivate کلاینت که اسلات را تا پایان اعتبار توکن اشغال نگه می‌دارد). */
  async releaseActivation(licenseId: string, activationId: string, actor: Actor) {
    const lic = await this.db.license.findUnique({ where: { id: licenseId }, select: { licenseKey: true } });
    await this.mutate(
      async (tx) => {
        const res = await tx.licenseActivation.updateMany({ where: { id: activationId, licenseId, deletedAt: null }, data: { deletedAt: new Date(), releasedBy: actor.label } });
        if (res.count === 0) throw new NotFoundException('فعال‌سازی یافت نشد');
        return true;
      },
      () => ({ kind: 'ADMIN', action: 'release_activation', licenseId, licenseKey: lic?.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { activationId } }),
    );
    return { ok: true };
  }

  /** توکن آفلاین: از همان منطق مشترک با CLI عبور می‌کند (issueOfflineTokenCore). خود توکن ذخیره نمی‌شود؛ فقط jti در ردپا. */
  async issueOfflineToken(id: string, dto: OfflineTokenDto, actor: Actor) {
    const lic = await this.mustGet(id);
    if (!this.signer.isConfigured()) throw new ServiceUnavailableException('کلید امضای لایسنس روی سرور پیکربندی نشده است');
    const st = await this.settings.get();
    let r;
    try {
      r = await issueOfflineTokenCore(this.db as never, this.signer.requireKey(), { licenseId: id, installationId: dto.installationId, validityDays: dto.validityDays, crlVersion: st.crlVersion });
    } catch (e) {
      if (e instanceof OfflineTokenError) throw new BadRequestException(e.message);
      throw e;
    }
    await this.audit.recordStrict({ kind: 'ADMIN', action: 'offline_token', licenseId: id, licenseKey: lic.licenseKey, actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { jti: r.payload.jti, installationId: dto.installationId.toLowerCase(), validityDays: dto.validityDays, reason: dto.reason } });
    return { token: r.token, expiresAt: r.payload.tokenExpiresAt };
  }

  /** نمایش/خروجی کامل کلیدها فقط SUPER_ADMIN و با ردپا. */
  async recordKeyAccess(action: 'export' | 'view', actor: Actor, licenseId?: string) {
    await this.audit.recordStrict({ kind: 'ADMIN', action: `key_${action}`, licenseId: licenseId ?? null, actorId: actor.id, actorLabel: actor.label, ip: actor.ip });
  }

  // ── رویدادها و تنظیمات ────────────────────────────────────────────────

  async events(q: ListEventsQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where = { ...(q.licenseId ? { licenseId: q.licenseId } : {}), ...(q.kind ? { kind: q.kind } : {}) };
    const [total, items] = await Promise.all([
      this.db.licenseEvent.count({ where }),
      this.db.licenseEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items };
  }

  async getSettings() {
    const s = await this.settings.get();
    return {
      ...s,
      signing: { configured: this.signer.isConfigured(), kid: this.signer.kid, publicKeyPem: this.signer.publicKeyPem() },
    };
  }

  async updateSettings(dto: LicenseSettingsDto, actor: Actor) {
    const s = await this.settings.set(dto);
    await this.audit.recordStrict({ kind: 'ADMIN', action: 'settings', actorId: actor.id, actorLabel: actor.label, ip: actor.ip, detail: { ...dto } });
    return s;
  }
}
