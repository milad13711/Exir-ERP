import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { VaultTicketPayload } from '../auth/jwt-payload.type.js';
import type { CreateConfidentialDocumentDto } from './dto/create-confidential-document.dto.js';
import type { UpdateConfidentialDocumentDto } from './dto/update-confidential-document.dto.js';

const VAULT_TICKET_TTL_SECONDS = 25 * 60; // 25 minutes — step-up session for browsing the archive

/**
 * Business logic for the confidential document archive. Two independent
 * access levels, matching the module's design brief:
 *   1. Submitting a document — any authenticated staff member with the
 *      module installed, no extra friction (see createDocument).
 *   2. Browsing/editing the archive — gated behind a step-up OTP re-sent to
 *      the CURRENT logged-in user's own on-file phone (never a phone they
 *      type in) AND an explicit ConfidentialArchiveAccess grant that only
 *      OWNER/ADMIN can hand out. A correct OTP code alone is never enough —
 *      see verifyOtp below, which checks the grant only after the code is
 *      confirmed valid, and rejects even a correct code if there's no grant.
 */
@Injectable()
export class ConfidentialArchiveService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  private isManager(ctx: TenantRequestContext): boolean {
    return ctx.auth.role === 'OWNER' || ctx.auth.role === 'ADMIN';
  }

  /** Resolves the CURRENT logged-in user's own tenant User row (id + on-file phone) — never a client-supplied phone. */
  private async resolveCurrentUser(ctx: TenantRequestContext): Promise<{ id: string; phone: string; name: string }> {
    if (ctx.auth.type === 'api_key') {
      throw new ForbiddenException('این عملیات فقط برای یک نشست کاربر واقعی ممکن است، نه کلید API');
    }
    const user = await ctx.tenantDb.user.findUnique({
      where: { globalUserId: ctx.auth.sub },
      select: { id: true, phone: true, name: true },
    });
    if (!user) throw new NotFoundException('کاربر در این محیط کاری یافت نشد');
    return user;
  }

  // ── ثبت سند — بدون OTP، بدون نیاز به مجوز آرشیو ──────────────────────────

  async createDocument(ctx: TenantRequestContext, dto: CreateConfidentialDocumentDto) {
    const userId = ctx.auth.type === 'api_key' ? null : (await this.resolveCurrentUser(ctx)).id;
    return ctx.tenantDb.confidentialDocument.create({
      data: {
        title: dto.title,
        category: dto.category,
        content: dto.content,
        fileName: dto.fileName,
        fileData: dto.fileData,
        createdByUserId: userId,
      },
    });
  }

  // ── گام پله‌ای OTP برای ورود به آرشیو ─────────────────────────────────────

  async requestVaultOtp(ctx: TenantRequestContext): Promise<{ expiresInSeconds: number; devCode?: string }> {
    const user = await this.resolveCurrentUser(ctx);
    return this.auth.requestOtp(user.phone, 'CONFIDENTIAL_ARCHIVE');
  }

  async verifyVaultOtp(ctx: TenantRequestContext, code: string): Promise<{ vaultTicket: string; expiresInSeconds: number; canEdit: boolean }> {
    const user = await this.resolveCurrentUser(ctx);

    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone: user.phone, purpose: 'CONFIDENTIAL_ARCHIVE', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('کد تأیید منقضی شده است، دوباره درخواست دهید');
    if (otp.attempts >= 5) throw new BadRequestException('تعداد تلاش‌های مجاز به پایان رسید، کد جدید درخواست دهید');

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    // کد درست بودن یعنی مالکِ همین شماره‌ی همین کاربر است — نه اینکه اجازه‌ی
    // مشاهده‌ی آرشیو را دارد. مجوز واقعی همین‌جا، جدا، بررسی می‌شود.
    let canEdit: boolean;
    if (this.isManager(ctx)) {
      canEdit = true;
    } else {
      const access = await ctx.tenantDb.confidentialArchiveAccess.findUnique({ where: { userId: user.id } });
      if (!access) {
        throw new ForbiddenException('شما مجوز مشاهده‌ی بایگانی اسناد محرمانه را ندارید — از مالک یا مدیر محیط کاری بخواهید دسترسی بدهد');
      }
      canEdit = access.canEdit;
    }

    const payload: VaultTicketPayload = { type: 'vault_ticket', sub: ctx.auth.sub, tenantId: ctx.tenantId, canEdit };
    const vaultTicket = await this.jwt.signAsync(payload, { expiresIn: VAULT_TICKET_TTL_SECONDS });
    return { vaultTicket, expiresInSeconds: VAULT_TICKET_TTL_SECONDS, canEdit };
  }

  // ── اسناد آرشیو — همه‌ی این‌ها زیر VaultTicketGuard هستند ────────────────

  /** اسناد «ownerOnly» (مثلاً تبدیل‌شده از پیوست‌ها) فقط برای سازنده و مالک/مدیر دیده می‌شوند. */
  private async visibleWhere(ctx: TenantRequestContext): Promise<Record<string, unknown>> {
    if (this.isManager(ctx)) return {};
    const me = ctx.auth.type === 'api_key' ? null : (await this.resolveCurrentUser(ctx)).id;
    return me ? { OR: [{ ownerOnly: false }, { createdByUserId: me }] } : { ownerOnly: false };
  }

  async listDocuments(ctx: TenantRequestContext) {
    return ctx.tenantDb.confidentialDocument.findMany({
      where: await this.visibleWhere(ctx),
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } }, updatedBy: { select: { id: true, name: true } } },
    });
  }

  async getDocument(ctx: TenantRequestContext, id: string) {
    const doc = await ctx.tenantDb.confidentialDocument.findFirst({
      where: { id, ...(await this.visibleWhere(ctx)) },
      include: { createdBy: { select: { id: true, name: true } }, updatedBy: { select: { id: true, name: true } } },
    });
    if (!doc) throw new NotFoundException('این سند یافت نشد');
    return doc;
  }

  async updateDocument(ctx: TenantRequestContext, id: string, dto: UpdateConfidentialDocumentDto) {
    const existing = await ctx.tenantDb.confidentialDocument.findFirst({ where: { id, ...(await this.visibleWhere(ctx)) } });
    if (!existing) throw new NotFoundException('این سند یافت نشد');
    const userId = ctx.auth.type === 'api_key' ? null : (await this.resolveCurrentUser(ctx)).id;
    return ctx.tenantDb.confidentialDocument.update({
      where: { id },
      data: { ...dto, updatedByUserId: userId },
      include: { createdBy: { select: { id: true, name: true } }, updatedBy: { select: { id: true, name: true } } },
    });
  }

  async deleteDocument(ctx: TenantRequestContext, id: string) {
    const existing = await ctx.tenantDb.confidentialDocument.findFirst({ where: { id, ...(await this.visibleWhere(ctx)) } });
    if (!existing) throw new NotFoundException('این سند یافت نشد');
    await ctx.tenantDb.confidentialDocument.delete({ where: { id } });
    return { ok: true };
  }

  // ── مدیریت دسترسی — فقط مالک/مدیر، بدون نیاز به OTP (این یک اقدام تنظیماتی است) ──

  async myAccess(ctx: TenantRequestContext): Promise<{ isManager: boolean; hasAccess: boolean; canEdit: boolean }> {
    if (this.isManager(ctx)) return { isManager: true, hasAccess: true, canEdit: true };
    if (ctx.auth.type === 'api_key') return { isManager: false, hasAccess: false, canEdit: false };
    const user = await this.resolveCurrentUser(ctx);
    const access = await ctx.tenantDb.confidentialArchiveAccess.findUnique({ where: { userId: user.id } });
    return { isManager: false, hasAccess: !!access, canEdit: access?.canEdit ?? false };
  }

  async listAccess(ctx: TenantRequestContext) {
    if (!this.isManager(ctx)) throw new ForbiddenException('فقط مالک یا مدیر می‌تواند دسترسی بایگانی را مدیریت کند');
    return ctx.tenantDb.confidentialArchiveAccess.findMany({
      include: { user: { select: { id: true, name: true } }, grantedBy: { select: { id: true, name: true } } },
      orderBy: { grantedAt: 'desc' },
    });
  }

  async setAccess(ctx: TenantRequestContext, userId: string, canEdit: boolean) {
    if (!this.isManager(ctx)) throw new ForbiddenException('فقط مالک یا مدیر می‌تواند دسترسی بایگانی را مدیریت کند');
    await ctx.tenantDb.user.findUniqueOrThrow({ where: { id: userId } });
    const grantedByUserId = ctx.auth.type === 'api_key' ? null : (await this.resolveCurrentUser(ctx)).id;
    return ctx.tenantDb.confidentialArchiveAccess.upsert({
      where: { userId },
      create: { userId, canEdit, grantedByUserId },
      update: { canEdit, grantedByUserId, grantedAt: new Date() },
    });
  }

  async revokeAccess(ctx: TenantRequestContext, userId: string) {
    if (!this.isManager(ctx)) throw new ForbiddenException('فقط مالک یا مدیر می‌تواند دسترسی بایگانی را مدیریت کند');
    await ctx.tenantDb.confidentialArchiveAccess.deleteMany({ where: { userId } });
    return { ok: true };
  }
}
