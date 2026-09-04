import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { ContractsService } from '../contracts/contracts.service.js';
import type { ContractSignTicketPayload } from '../auth/jwt-payload.type.js';
import type { TenantRequestContext } from '../common/request-context.js';

const CONTRACT_SIGN_TOKEN_TTL_SECONDS = 15 * 60;

const CONTRACT_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true } },
  employee: { select: { id: true, fullName: true, phone: true } },
  secondPartyContact: { select: { id: true, name: true, company: true, phone: true } },
  editRequests: { orderBy: { createdAt: 'desc' as const } },
  amendments: { orderBy: { createdAt: 'desc' as const } },
} as const;

/**
 * Unauthenticated dual-party e-signature flow for a contract's public link
 * (`/sign/[slug]/[publicToken]`) — either party enters their own phone,
 * OTP-verifies, and the phone is matched against the contract's own party
 * records to determine which side ("PARTY_A"/"PARTY_B") they are, so the
 * client never gets to assert its own identity. From there they can view
 * the contract, submit an edit request, or (once satisfied) sign — a fresh
 * OTP ticket gates every one of those actions, mirroring the tracking/
 * booking public-wizard pattern already used elsewhere in this codebase.
 */
@Injectable()
export class PublicContractsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly contracts: ContractsService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveTenant(slug: string) {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const contractsModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'contracts' } },
    });
    if (!contractsModule) throw new NotFoundException('امضای دیجیتال قرارداد برای این کسب‌وکار فعال نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenant, tenantDb };
  }

  private buildCtx(tenantId: string, slug: string, tenantDb: ReturnType<TenantPrismaService['forTenant']>): TenantRequestContext {
    return { tenantId, tenantSlug: slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  private async getContractByToken(tenantDb: ReturnType<TenantPrismaService['forTenant']>, publicToken: string) {
    const contract = await tenantDb.contract.findUnique({ where: { publicToken }, include: CONTRACT_INCLUDE });
    if (!contract) throw new NotFoundException('این لینک قرارداد معتبر نیست');
    return contract;
  }

  private resolveSide(contract: { contact: { phone: string | null } | null; employee: { phone: string | null } | null; secondPartyContact: { phone: string | null } | null; secondPartyPhone: string | null }, phone: string): 'PARTY_A' | 'PARTY_B' {
    const partyAPhone = contract.employee?.phone ?? contract.contact?.phone ?? null;
    const partyBPhone = contract.secondPartyContact?.phone ?? contract.secondPartyPhone ?? null;
    if (partyAPhone && partyAPhone === phone) return 'PARTY_A';
    if (partyBPhone && partyBPhone === phone) return 'PARTY_B';
    throw new BadRequestException('این شماره موبایل با هیچ‌یک از طرفین این قرارداد مطابقت ندارد');
  }

  async requestOtp(slug: string, publicToken: string, phone: string) {
    const { tenantDb } = await this.resolveTenant(slug);
    const contract = await this.getContractByToken(tenantDb, publicToken);
    this.resolveSide(contract, phone); // throws if phone doesn't belong to either party
    return this.auth.requestOtp(phone, 'CONTRACT_SIGN');
  }

  async verifyOtp(slug: string, publicToken: string, phone: string, code: string): Promise<{ ticket: string; expiresInSeconds: number; side: 'PARTY_A' | 'PARTY_B' }> {
    const { tenantDb } = await this.resolveTenant(slug);
    const contract = await this.getContractByToken(tenantDb, publicToken);
    const side = this.resolveSide(contract, phone);

    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'CONTRACT_SIGN', consumedAt: null, expiresAt: { gt: new Date() } },
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

    const payload: ContractSignTicketPayload = { type: 'contract_sign_ticket', phone, tenantSlug: slug, contractId: contract.id, side };
    const ticket = await this.jwt.signAsync(payload, { expiresIn: CONTRACT_SIGN_TOKEN_TTL_SECONDS });
    return { ticket, expiresInSeconds: CONTRACT_SIGN_TOKEN_TTL_SECONDS, side };
  }

  private async resolveTicket(slug: string, publicToken: string, ticket: string): Promise<{ contractId: string; side: 'PARTY_A' | 'PARTY_B' }> {
    let payload: ContractSignTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<ContractSignTicketPayload>(ticket);
    } catch {
      throw new UnauthorizedException('نشست امضا منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'contract_sign_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست امضا نامعتبر است');
    }
    return { contractId: payload.contractId, side: payload.side };
  }

  async view(slug: string, publicToken: string, ticket: string) {
    const { tenantDb } = await this.resolveTenant(slug);
    const contract = await this.getContractByToken(tenantDb, publicToken);
    const { contractId } = await this.resolveTicket(slug, publicToken, ticket);
    if (contractId !== contract.id) throw new UnauthorizedException('نشست امضا نامعتبر است');
    return contract;
  }

  async submitEditRequest(slug: string, publicToken: string, ticket: string, text: string) {
    const { tenant, tenantDb } = await this.resolveTenant(slug);
    const contract = await this.getContractByToken(tenantDb, publicToken);
    const { contractId, side } = await this.resolveTicket(slug, publicToken, ticket);
    if (contractId !== contract.id) throw new UnauthorizedException('نشست امضا نامعتبر است');
    if (contract.isLocked) throw new BadRequestException('این قرارداد قبلاً امضا و قفل شده است');

    void tenant;
    return tenantDb.contractEditRequest.create({ data: { contractId, side, text } });
  }

  async sign(slug: string, publicToken: string, ticket: string, signatureDataUrl: string, signerName: string, amendmentId: string | undefined) {
    const { tenant, tenantDb } = await this.resolveTenant(slug);
    const contract = await this.getContractByToken(tenantDb, publicToken);
    const { contractId, side } = await this.resolveTicket(slug, publicToken, ticket);
    if (contractId !== contract.id) throw new UnauthorizedException('نشست امضا نامعتبر است');

    const ctx = this.buildCtx(tenant.id, slug, tenantDb);

    if (amendmentId) {
      const amendment = await tenantDb.contractAmendment.findUnique({ where: { id: amendmentId } });
      if (!amendment || amendment.contractId !== contract.id) throw new NotFoundException('الحاقیه یافت نشد');
      if (amendment.isLocked) throw new BadRequestException('این الحاقیه قبلاً به‌طور کامل امضا شده است');

      if (side === 'PARTY_A') {
        if (amendment.partyASignedAt) throw new BadRequestException('این طرف قبلاً این الحاقیه را امضا کرده است');
        await tenantDb.contractAmendment.update({ where: { id: amendmentId }, data: { partyASignedAt: new Date(), partyASignatureDataUrl: signatureDataUrl } });
      } else {
        if (amendment.partyBSignedAt) throw new BadRequestException('این طرف قبلاً این الحاقیه را امضا کرده است');
        await tenantDb.contractAmendment.update({ where: { id: amendmentId }, data: { partyBSignedAt: new Date(), partyBSignatureDataUrl: signatureDataUrl } });
      }
      return this.contracts.finalizeAmendmentIfComplete(ctx, amendmentId);
    }

    if (contract.isLocked) throw new BadRequestException('این قرارداد قبلاً امضا و قفل شده است');

    if (side === 'PARTY_A') {
      if (contract.partyASignedAt) throw new BadRequestException('این طرف قبلاً این قرارداد را امضا کرده است');
      await tenantDb.contract.update({
        where: { id: contract.id },
        data: { partyASignedAt: new Date(), partyASignatureDataUrl: signatureDataUrl, partyASignerName: signerName },
      });
    } else {
      if (contract.partyMode !== 'THIRD_PARTY') {
        throw new BadRequestException('طرف شرکت این قرارداد فقط از داخل پنل می‌تواند امضا کند');
      }
      if (contract.partyBSignedAt) throw new BadRequestException('این طرف قبلاً این قرارداد را امضا کرده است');
      await tenantDb.contract.update({
        where: { id: contract.id },
        data: { partyBSignedAt: new Date(), partyBSignatureDataUrl: signatureDataUrl, partyBSignerName: signerName },
      });
    }

    return this.contracts.finalizeIfComplete(ctx, contract.id);
  }
}
