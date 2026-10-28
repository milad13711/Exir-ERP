import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { PrismaClient as TenantPrismaClient, SignatureEvidence } from '../../../generated/tenant-client/index.js';
import { clientIp } from '../../security/client-ip.js';
import type { TenantRequestContext } from '../request-context.js';
import type { ClientSignatureEvidence } from './signature-evidence.dto.js';
import { computeIntegrityHash, formatTehran, hashSignature, parseUserAgent, verifyIntegrity } from './signature-evidence.util.js';

export type RecordSignatureEvidenceInput = {
  entityType: string;
  entityId: string;
  action: string;
  signerName?: string;
  signerPhone?: string;
  signerUserId?: string;
  signerRole?: string;
  /** هش SHA-256 از عکس لحظه‌ای سند امضاشده (hashContent(...)). */
  contentHash?: string;
  /** تصویر امضا؛ فقط هش آن ذخیره می‌شود. */
  signatureData?: string;
  /** سطح تأیید هویت امضاکننده؛ مثلاً 'link_only' = فقط دارنده‌ی لینک عمومی (هویت راستی‌آزمایی نشده). در device ذخیره و در هش یکپارچگی لحاظ می‌شود. */
  verification?: string;
  req: Request;
  clientEvidence?: ClientSignatureEvidence;
};

type DbLike = { tenantDb: TenantPrismaClient } | TenantPrismaClient;

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function parseClientTime(v: unknown): Date | undefined {
  const s = str(v, 40);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** از ورودی کلاینت، وضعیت/مختصات موقعیت را پاک‌سازی می‌کند؛ بدون مختصات معتبر هرگز «granted» نمی‌ماند. */
export function normalizeGeo(geo: ClientSignatureEvidence['geo'] | undefined): { geoStatus: string; lat?: number; lng?: number; geoAccuracy?: number } {
  if (!geo) return { geoStatus: 'unavailable' };
  if (geo.status === 'granted') {
    const lat = num(geo.lat);
    const lng = num(geo.lng);
    if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { geoStatus: 'unavailable' };
    return { geoStatus: 'granted', lat, lng, geoAccuracy: num(geo.accuracy) };
  }
  return { geoStatus: geo.status === 'denied' ? 'denied' : 'unavailable' };
}

@Injectable()
export class SignatureEvidenceService {
  private readonly logger = new Logger(SignatureEvidenceService.name);

  private db(ctx: DbLike): TenantPrismaClient {
    return 'tenantDb' in ctx ? ctx.tenantDb : ctx;
  }

  async record(ctx: DbLike, input: RecordSignatureEvidenceInput): Promise<SignatureEvidence> {
    const { req, clientEvidence: ce } = input;
    const serverTime = new Date();
    const ua = str(req?.headers?.['user-agent'], 512);
    const parsed = parseUserAgent(ua);
    const geo = normalizeGeo(ce?.geo);
    const device = {
      platform: str(ce?.platform, 80) ?? parsed.os,
      os: parsed.os,
      browser: parsed.browser,
      browserVersion: parsed.browserVersion ?? null,
      deviceType: parsed.deviceType,
      language: str(ce?.language, 40) ?? str(req?.headers?.['accept-language'], 80)?.split(',')[0] ?? null,
      timezone: str(ce?.timezone, 80) ?? null,
      screen: ce?.screen && num(ce.screen.w) !== undefined && num(ce.screen.h) !== undefined ? { w: ce.screen.w, h: ce.screen.h } : null,
      touch: typeof ce?.touch === 'boolean' ? ce.touch : null,
      serverTimeUtc: serverTime.toISOString(),
      serverTimeTehran: formatTehran(serverTime),
      ...(str(input.verification, 40) ? { verification: str(input.verification, 40) } : {}),
    };
    const base = {
      id: randomUUID(),
      entityType: input.entityType.slice(0, 80),
      entityId: input.entityId.slice(0, 120),
      action: input.action.slice(0, 80),
      signerName: str(input.signerName, 200) ?? null,
      signerPhone: str(input.signerPhone, 40) ?? null,
      signerUserId: str(input.signerUserId, 80) ?? null,
      signerRole: str(input.signerRole, 80) ?? null,
      ip: req ? clientIp(req) : null,
      userAgent: ua ?? null,
      device,
      geoStatus: geo.geoStatus,
      lat: geo.lat ?? null,
      lng: geo.lng ?? null,
      geoAccuracy: geo.geoAccuracy ?? null,
      clientTime: parseClientTime(ce?.clientTime) ?? null,
      serverTime,
      contentHash: input.contentHash ?? null,
      signatureHash: hashSignature(input.signatureData) ?? null,
    };
    const integrityHash = computeIntegrityHash(base);
    return this.db(ctx).signatureEvidence.create({ data: { ...base, integrityHash } });
  }

  /** مثل record ولی خطا را فقط لاگ می‌کند — برای مسیرهایی که نباید بعد از ثبت امضا شکست بخورند. */
  async tryRecord(ctx: DbLike, input: RecordSignatureEvidenceInput): Promise<SignatureEvidence | null> {
    try {
      return await this.record(ctx, input);
    } catch (e) {
      this.logger.error(`ثبت مدرک امضا ناموفق بود (${input.entityType}/${input.entityId}): ${(e as Error).message}`);
      return null;
    }
  }

  listFor(ctx: DbLike, entityType: string, entityId: string): Promise<SignatureEvidence[]> {
    return this.db(ctx).signatureEvidence.findMany({ where: { entityType, entityId }, orderBy: { serverTime: 'asc' } });
  }

  verify(record: SignatureEvidence): boolean {
    return verifyIntegrity(record as never);
  }
}

export type { TenantRequestContext };
