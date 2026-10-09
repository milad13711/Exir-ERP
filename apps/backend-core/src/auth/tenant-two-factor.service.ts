import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import QRCode from 'qrcode';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { AppSecretsKeyMissingError, openSecret, sealSecret, totpAad } from '../security/app-secrets.js';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from '../security/totp.js';

/**
 * TOTP اختیاری (opt-in) برای مالک/مدیر هر محیط کاری. وقتی فعال باشد، ورود با OTP پیامکی به‌تنهایی کافی نیست
 * (سیم‌کارت‌دزدی/SIM-swap یا شنود پیامک دیگر برای تصاحب حساب مدیر بسنده نیست). راز روی GlobalUser با AES-256-GCM
 * (APP_SECRETS_KEY) ذخیره می‌شود؛ کدهای بازیابی فقط هش.
 */
@Injectable()
export class TenantTwoFactorService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly events: SecurityEventsService,
  ) {}

  async status(globalUserId: string) {
    const u = await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: globalUserId } });
    return { enabled: !!u.totpEnabledAt, recoveryCodesLeft: u.recoveryCodeHashes.length };
  }

  async beginSetup(globalUserId: string) {
    const u = await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: globalUserId } });
    if (u.totpEnabledAt) throw new BadRequestException('تأیید دومرحله‌ای از قبل فعال است؛ ابتدا غیرفعال کنید');
    const secret = generateTotpSecret();
    try {
      await this.controlDb.globalUser.update({ where: { id: u.id }, data: { totpSecretEnc: sealSecret(secret, totpAad('user', u.id)), totpLastStep: null } });
    } catch (err) {
      if (err instanceof AppSecretsKeyMissingError) throw new HttpException('رمزنگاری رازها روی سرور پیکربندی نشده است (APP_SECRETS_KEY)', HttpStatus.SERVICE_UNAVAILABLE);
      throw err;
    }
    const url = otpauthUrl(u.phone, secret);
    return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
  }

  async enable(globalUserId: string, code: string) {
    const u = await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: globalUserId } });
    if (u.totpEnabledAt || !u.totpSecretEnc) throw new BadRequestException('ابتدا راه‌اندازی را شروع کنید');
    const step = verifyTotp(openSecret(u.totpSecretEnc, totpAad('user', u.id)).value, code);
    if (step === null) throw new BadRequestException('کد نادرست است');
    const codes = generateRecoveryCodes();
    await this.controlDb.globalUser.update({
      where: { id: u.id },
      data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: codes.map(hashRecoveryCode) },
    });
    this.events.record({ type: 'TOTP_ENABLED', severity: 'INFO', actor: u.id, message: 'tenant user 2FA enabled' });
    return { recoveryCodes: codes };
  }

  async disable(globalUserId: string, code: string) {
    const u = await this.controlDb.globalUser.findUniqueOrThrow({ where: { id: globalUserId } });
    if (!u.totpEnabledAt) return { enabled: false };
    if (!(await this.checkCode(u.id, code))) throw new UnauthorizedException('کد تأیید نادرست است');
    await this.controlDb.globalUser.update({
      where: { id: u.id },
      data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null, recoveryCodeHashes: [] },
    });
    this.events.record({ type: 'TOTP_DISABLED', severity: 'WARNING', actor: u.id, message: 'tenant user 2FA disabled' });
    return { enabled: false };
  }

  /** کد TOTP یا بازیابی را (با محافظت در برابر بازپخش) بررسی و مصرف می‌کند. */
  async checkCode(globalUserId: string, code: string, ip?: string): Promise<boolean> {
    const u = await this.controlDb.globalUser.findUnique({ where: { id: globalUserId } });
    if (!u?.totpEnabledAt || !u.totpSecretEnc) return false;
    const step = verifyTotp(openSecret(u.totpSecretEnc, totpAad('user', u.id)).value, code, { lastUsedStep: u.totpLastStep });
    if (step !== null) {
      const upd = await this.controlDb.globalUser.updateMany({
        where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      if (upd.count === 1) return true;
    } else {
      const h = hashRecoveryCode(code);
      if (u.recoveryCodeHashes.includes(h)) {
        const upd = await this.controlDb.globalUser.updateMany({
          where: { id: u.id, recoveryCodeHashes: { has: h } },
          data: { recoveryCodeHashes: u.recoveryCodeHashes.filter((x) => x !== h) },
        });
        if (upd.count === 1) {
          this.events.record({ type: 'LOGIN_SUCCESS', severity: 'WARNING', ip, actor: u.id, message: 'tenant login with 2FA RECOVERY code', context: { remaining: u.recoveryCodeHashes.length - 1 } });
          return true;
        }
      }
    }
    this.events.record({ type: 'TOTP_FAILED', severity: 'WARNING', ip, actor: u.id, message: 'tenant 2FA code rejected', dedupeKey: u.id });
    return false;
  }

  assertCanManage(role: string | undefined, authType: string | undefined): void {
    if (authType !== 'tenant_user') throw new ForbiddenException('فقط با نشست کاربری مجاز است');
    if (role !== 'OWNER' && role !== 'ADMIN') throw new ForbiddenException('تأیید دومرحله‌ای برای مالک و مدیر محیط کاری است');
  }
}
