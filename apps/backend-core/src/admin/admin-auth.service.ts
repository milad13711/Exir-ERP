import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { AdminJwtPayload } from '../auth/jwt-payload.type.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { SessionEpochService } from '../security/session-epoch.service.js';
import { AppSecretsKeyMissingError, openSecret, sealSecret, totpAad } from '../security/app-secrets.js';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from '../security/totp.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_S = 5 * 60;
// هش ساختگی برای مقایسه‌ی هم‌زمان وقتی ایمیل وجود ندارد → زمان پاسخ، وجود ایمیل را لو نمی‌دهد
const DUMMY_HASH = bcrypt.hashSync('exir-dummy-password-for-timing', 10);
// رمزهای پیش‌فرضِ داخل مخزن (seed/README قدیمی) — در production حتی با ورودِ درست پذیرفته نمی‌شوند.
const KNOWN_DEFAULT_PASSWORDS = new Set(['ExirAdmin123!', 'ExirSupport123!']);
const GENERIC_FAIL = 'ایمیل یا رمز عبور اشتباه است';

type LoginOk = { accessToken: string; admin: { id: string; name: string; team: string } };
export type AdminLoginResult = LoginOk | { requiresTotp: true; challengeToken: string };

type ChallengePayload = { type: 'admin_totp_challenge'; sub: string };

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly jwt: JwtService,
    private readonly events: SecurityEventsService,
    private readonly epoch: SessionEpochService,
  ) {}

  private adminTokenTtl(): number {
    return Number(process.env.ADMIN_JWT_EXPIRES_IN_SECONDS) || 12 * 3600;
  }

  private async issueToken(admin: { id: string; name: string; team: string; tokenVersion: number }): Promise<LoginOk> {
    const payload: AdminJwtPayload = {
      sub: admin.id,
      team: admin.team,
      isAdmin: true,
      tv: await this.epoch.effective(admin.tokenVersion),
    };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.adminTokenTtl() });
    return { accessToken, admin: { id: admin.id, name: admin.name, team: admin.team } };
  }

  private assertNotLocked(admin: { lockedUntil: Date | null }): void {
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      throw new HttpException('تلاش‌های ناموفق زیاد بود؛ حساب موقتاً قفل است. بعداً دوباره تلاش کنید.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async registerFailure(admin: { id: string; email: string; failedLoginCount: number }, ip: string | undefined, why: string): Promise<void> {
    const failed = admin.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED;
    await this.controlDb.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : undefined },
    });
    this.events.record({
      type: lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
      severity: lock ? 'ERROR' : 'WARNING',
      ip,
      actor: admin.id,
      message: `admin ${why} failure${lock ? ' — account locked 15m' : ''}`,
    });
  }

  async login(email: string, password: string, ip?: string): Promise<AdminLoginResult> {
    const admin = await this.controlDb.adminUser.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } });
    if (!admin || !admin.isActive) {
      await bcrypt.compare(password, DUMMY_HASH);
      this.events.record({ type: 'LOGIN_FAILED', severity: 'WARNING', ip, message: 'admin login: unknown or inactive account', dedupeKey: ip });
      throw new UnauthorizedException(GENERIC_FAIL);
    }
    this.assertNotLocked(admin);
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      await this.registerFailure(admin, ip, 'password');
      throw new UnauthorizedException(GENERIC_FAIL);
    }
    if (process.env.NODE_ENV === 'production' && process.env.ADMIN_ALLOW_DEFAULT_PASSWORDS !== 'true' && KNOWN_DEFAULT_PASSWORDS.has(password)) {
      this.events.record({ type: 'CONFIG_INSECURE', severity: 'FATAL', ip, actor: admin.id, message: 'admin login blocked: account still uses a repository-default password — rotate with create-admin-user' });
      throw new ForbiddenException('این حساب هنوز رمز پیش‌فرض دارد و ورود مسدود شد. روی سرور با create-admin-user رمز را عوض کنید (docs/security/runbook-incident.md).');
    }
    if (admin.totpEnabledAt && admin.totpSecretEnc) {
      const challengePayload: ChallengePayload = { type: 'admin_totp_challenge', sub: admin.id };
      const challengeToken = await this.jwt.signAsync(challengePayload, { expiresIn: CHALLENGE_TTL_S });
      return { requiresTotp: true, challengeToken };
    }
    await this.controlDb.adminUser.update({ where: { id: admin.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    this.events.record({ type: 'LOGIN_SUCCESS', severity: 'INFO', ip, actor: admin.id, message: 'admin login (no 2FA)' });
    return this.issueToken(admin);
  }

  /** گام دوم ورود: کد TOTP یا یکی از کدهای بازیابی (تک‌مصرف). */
  async loginWithTotp(challengeToken: string, code: string, ip?: string): Promise<LoginOk> {
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<ChallengePayload>(challengeToken, { algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('مهلت تأیید دومرحله‌ای تمام شد؛ دوباره وارد شوید');
    }
    if (payload.type !== 'admin_totp_challenge') throw new UnauthorizedException('درخواست نامعتبر است');
    const admin = await this.controlDb.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive || !admin.totpEnabledAt || !admin.totpSecretEnc) throw new UnauthorizedException('درخواست نامعتبر است');
    this.assertNotLocked(admin);

    const secret = openSecret(admin.totpSecretEnc, totpAad('admin', admin.id)).value;
    const step = verifyTotp(secret, code, { lastUsedStep: admin.totpLastStep });
    let ok = false;
    if (step !== null) {
      // به‌روزرسانی شرطی: دو درخواست هم‌زمان با یک کد، فقط یکی موفق می‌شود
      const upd = await this.controlDb.adminUser.updateMany({
        where: { id: admin.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step, failedLoginCount: 0, lockedUntil: null },
      });
      ok = upd.count === 1;
    } else {
      const h = hashRecoveryCode(code);
      if (admin.recoveryCodeHashes.includes(h)) {
        const upd = await this.controlDb.adminUser.updateMany({
          where: { id: admin.id, recoveryCodeHashes: { has: h } },
          data: { recoveryCodeHashes: admin.recoveryCodeHashes.filter((x) => x !== h), failedLoginCount: 0, lockedUntil: null },
        });
        ok = upd.count === 1;
        if (ok) this.events.record({ type: 'LOGIN_SUCCESS', severity: 'WARNING', ip, actor: admin.id, message: 'admin login with RECOVERY code', context: { remaining: admin.recoveryCodeHashes.length - 1 } });
      }
    }
    if (!ok) {
      await this.registerFailure(admin, ip, '2fa');
      this.events.record({ type: 'TOTP_FAILED', severity: 'WARNING', ip, actor: admin.id, message: 'admin 2FA code rejected' });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    this.events.record({ type: 'LOGIN_SUCCESS', severity: 'INFO', ip, actor: admin.id, message: 'admin login (2FA)' });
    return this.issueToken(admin);
  }

  // ── مدیریت 2FA (کارشناس واردشده) ─────────────────────────────────────────

  async status(adminId: string) {
    const a = await this.controlDb.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    return { enabled: !!a.totpEnabledAt, recoveryCodesLeft: a.recoveryCodeHashes.length, required: process.env.ADMIN_REQUIRE_TOTP === 'true' };
  }

  async beginSetup(adminId: string) {
    const a = await this.controlDb.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (a.totpEnabledAt) throw new BadRequestException('تأیید دومرحله‌ای از قبل فعال است؛ ابتدا غیرفعال کنید');
    const secret = generateTotpSecret();
    try {
      await this.controlDb.adminUser.update({ where: { id: a.id }, data: { totpSecretEnc: sealSecret(secret, totpAad('admin', a.id)), totpLastStep: null } });
    } catch (err) {
      if (err instanceof AppSecretsKeyMissingError) throw new HttpException('APP_SECRETS_KEY روی سرور تنظیم نشده است', HttpStatus.SERVICE_UNAVAILABLE);
      throw err;
    }
    return { secret, otpauthUrl: otpauthUrl(a.email, secret) };
  }

  async enable(adminId: string, code: string) {
    const a = await this.controlDb.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (a.totpEnabledAt || !a.totpSecretEnc) throw new BadRequestException('ابتدا راه‌اندازی را شروع کنید');
    const step = verifyTotp(openSecret(a.totpSecretEnc, totpAad('admin', a.id)).value, code);
    if (step === null) throw new BadRequestException('کد نادرست است');
    const codes = generateRecoveryCodes();
    await this.controlDb.adminUser.update({
      where: { id: a.id },
      data: { totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: codes.map(hashRecoveryCode) },
    });
    this.events.record({ type: 'TOTP_ENABLED', severity: 'INFO', actor: a.id, message: 'admin 2FA enabled' });
    return { recoveryCodes: codes }; // فقط همین یک‌بار نمایش داده می‌شود
  }

  async disable(adminId: string, password: string, code: string) {
    const a = await this.controlDb.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!(await bcrypt.compare(password, a.passwordHash))) throw new UnauthorizedException('رمز عبور اشتباه است');
    if (!a.totpEnabledAt || !a.totpSecretEnc) return { enabled: false };
    const okTotp = verifyTotp(openSecret(a.totpSecretEnc, totpAad('admin', a.id)).value, code, { lastUsedStep: a.totpLastStep }) !== null;
    if (!okTotp && !a.recoveryCodeHashes.includes(hashRecoveryCode(code))) throw new UnauthorizedException('کد تأیید نادرست است');
    await this.controlDb.adminUser.update({
      where: { id: a.id },
      data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null, recoveryCodeHashes: [], tokenVersion: { increment: 1 } },
    });
    this.events.record({ type: 'TOTP_DISABLED', severity: 'WARNING', actor: a.id, message: 'admin 2FA disabled' });
    return { enabled: false };
  }
}
