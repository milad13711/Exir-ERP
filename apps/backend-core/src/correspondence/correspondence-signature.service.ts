import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { Prisma } from '../../generated/tenant-client/index.js';
import type { TenantRequestContext } from '../common/request-context.js';
import {
  DEFAULT_SIGNATURE_DEFAULTS, SETTING_KEY, SETTING_MODULE, resolveSignatureBlock, sanitizeDefaults, sanitizeSignatureBlock,
  type ResolvedSignature, type SignatureBlock, type SignatureDefaults,
} from './signature-block.js';

/** پیش‌فرض بلوک امضا (سازمان + هر امضاکننده) در ModuleSetting و محاسبه‌ی بلوک مؤثر. */
@Injectable()
export class CorrespondenceSignatureService {
  constructor(@Optional() private readonly controlDb?: ControlPrismaService) {}

  async orgName(ctx: TenantRequestContext): Promise<string> {
    const t = await this.controlDb?.tenant.findUnique({ where: { id: ctx.tenantId }, select: { name: true } }).catch(() => null);
    return t?.name ?? 'سازمان';
  }

  async getDefaults(ctx: TenantRequestContext): Promise<SignatureDefaults> {
    const row = await ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: SETTING_MODULE, key: SETTING_KEY } } });
    if (!row) return { ...DEFAULT_SIGNATURE_DEFAULTS, perSigner: {} };
    try {
      return sanitizeDefaults(row.value);
    } catch {
      return { ...DEFAULT_SIGNATURE_DEFAULTS, perSigner: {} };
    }
  }

  async setDefaults(ctx: TenantRequestContext, input: unknown): Promise<SignatureDefaults> {
    let clean: SignatureDefaults;
    try {
      clean = sanitizeDefaults(input);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'پیش‌فرض بلوک امضا نامعتبر است');
    }
    const value = clean as unknown as Prisma.InputJsonValue;
    await ctx.tenantDb.moduleSetting.upsert({
      where: { moduleCode_key: { moduleCode: SETTING_MODULE, key: SETTING_KEY } },
      create: { moduleCode: SETTING_MODULE, key: SETTING_KEY, value },
      update: { value },
    });
    return clean;
  }

  /** نام و سمتِ پروفایلی یک کاربر (سمت از پرونده‌ی پرسنلی) */
  async profileOf(ctx: TenantRequestContext, userId: string | null): Promise<{ name: string; title: string | null }> {
    if (!userId) return { name: '', title: null };
    const [u, emp] = await Promise.all([
      ctx.tenantDb.user.findUnique({ where: { id: userId }, select: { name: true } }),
      ctx.tenantDb.employee.findUnique({ where: { userId }, select: { position: true } }).catch(() => null),
    ]);
    return { name: u?.name ?? '', title: emp?.position ?? null };
  }

  /** بلوک مؤثر برای یک امضاکننده (برای پیش‌فرض‌های فرم و رندر). block=null → همه‌چیز خودکار. */
  async resolve(ctx: TenantRequestContext, signerUserId: string | null, block: unknown, override?: { name?: string; title?: string | null }): Promise<ResolvedSignature> {
    const [defaults, profile, orgName] = await Promise.all([this.getDefaults(ctx), this.profileOf(ctx, signerUserId), this.orgName(ctx)]);
    return resolveSignatureBlock({
      block: block && typeof block === 'object' ? (block as SignatureBlock) : null,
      defaults, signerUserId,
      profileName: override?.name ?? profile.name,
      profileTitle: override?.title !== undefined ? override.title : profile.title,
      orgName,
    });
  }

  sanitize(input: unknown): SignatureBlock {
    return sanitizeSignatureBlock(input);
  }
}
