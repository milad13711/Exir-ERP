import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { VaultTicketPayload } from '../../auth/jwt-payload.type.js';
import { REQUIRE_VAULT_EDIT_KEY } from '../decorators/require-vault-edit.decorator.js';

const HEADER_NAME = 'x-vault-ticket';

/**
 * Second gate on top of JwtAuthGuard+ModuleGuard for the confidential-archive
 * module: even a fully authenticated staff member with the module installed
 * can only list/read/edit/delete documents if they also carry a valid,
 * unexpired "vault ticket" — issued by ConfidentialArchiveService.verifyOtp
 * after a step-up OTP re-verification AND an explicit access grant (see
 * jwt-payload.type.ts's VaultTicketPayload doc comment for the full model).
 *
 * Runs after JwtAuthGuard in the same @UseGuards array (needs req.ctx).
 * The ticket travels in the X-Vault-Ticket header, kept fully separate from
 * the normal Authorization bearer token so the two lifetimes never mix.
 */
@Injectable()
export class VaultTicketGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = req.ctx;
    if (!ctx) return true; // JwtAuthGuard didn't run first — not this guard's concern

    const raw = req.headers[HEADER_NAME];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) {
      throw new UnauthorizedException('برای مشاهده‌ی آرشیو، ابتدا هویت خود را با کد پیامکی دوباره تأیید کنید');
    }

    let payload: VaultTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<VaultTicketPayload>(token);
    } catch {
      throw new UnauthorizedException('نشست ورود به آرشیو منقضی شده، دوباره با کد پیامکی تأیید کنید');
    }
    if (payload.type !== 'vault_ticket' || payload.tenantId !== ctx.tenantId || payload.sub !== ctx.auth.sub) {
      throw new UnauthorizedException('نشست ورود به آرشیو نامعتبر است');
    }

    const requireEdit = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_VAULT_EDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requireEdit && !payload.canEdit) {
      throw new ForbiddenException('شما فقط دسترسی مشاهده به آرشیو دارید، نه ویرایش/حذف');
    }

    req.vaultTicket = payload;
    return true;
  }
}
