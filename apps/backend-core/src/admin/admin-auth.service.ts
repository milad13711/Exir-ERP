import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { AdminJwtPayload } from '../auth/jwt-payload.type.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { SessionEpochService } from '../security/session-epoch.service.js';
import { AppSecretsKeyMissingError, openSecret, sealSecret, totpAad } from '../security/app-secrets.js';
import { isKnownDefaultPassword, validateAdminPassword } from './admin-password-policy.js';
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUrl, verifyTotp } from '../security/totp.js';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_S = 5 * 60;
// هش ساختگی برای مقایسه‌ی هم‌زمان وقتی ایمیل وجود ندارد → زمان پاسخ، وجود ایمیل را لو نمی‌دهد
const DUMMY_HASH = bcrypt.hashSync('exir-dummy-password-for-timing', 10);
const BCRYPT_COST = 12;
const RESTRICTED_TOKEN_TTL_S = 30 * 60;
const GENERIC_FAIL = 'ایمیل یا رمز عبور اشتباه است';

type LoginOk = { accessToken: string; mustChangePassword: boolean; admin: { id: string; name: string; team: string } };
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

  /** نشستِ محدود (mcp) برای حساب‌های دارای رمز پیش‌فرض/یک‌بارمصرف: عمر کوتاه‌تر و فقط مسیرهای تغییر رمز. */
  private async issueToken(admin: { id: string; name: string; team: string; tokenVersion: number; mustChangePassword?: boolean }): Promise<LoginOk> {
    const restricted = admin.mustChangePassword === true;
    const payload: AdminJwtPayload = {
      sub: admin.id,
      team: admin.team,
      isAdmin: true,
      tv: await this.epoch.effective(admin.tokenVersion),
      ...(restricted ? { mcp: true as const } : {}),
    };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: restricted ? Math.min(RESTRICTED_TOKEN_TTL_S, this.adminTokenTtl()) : this.adminTokenTtl() });
    return { accessToken, mustChangePassword: restricted, admin: { id: admin.id, name: admin.name, team: admin.team } };
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
    // رمز پیش‌فرضِ منتشرشده در production: ورود مجاز است اما فقط با نشست محدود تا رمز عوض شود (قفل‌شدن مالک جلوگیری می‌شود).
    if (process.env.NODE_ENV === 'production' && isKnownDefaultPassword(password) && !admin.mustChangePassword) {
      await this.controlDb.adminUser.update({ where: { id: admin.id }, data: { mustChangePassword: true } });
      admin.mustChangePassword = true;
      this.events.record({ type: 'CONFIG_INSECURE', severity: 'FATAL', ip, actor: admin.id, message: 'admin logged in with a repository-default password — session restricted until the password is changed' });
    }
    if (admin.totpEnabledAt && admin.totpSecretEnc) {
      const challengePayload: ChallengePayload = { type: 'admin_totp_challenge', sub: admin.id };
      const challengeToken = await this.jwt.signAsync(challengePayload, { expiresIn: CHALLENGE_TTL_S });
      return { requiresTotp: true, challengeToken };
    }
    await this.controlDb.adminUser.update({ where: { id: admin.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
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
        data: { totpLastStep: step, failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      ok = upd.count === 1;
    } else {
      const h = hashRecoveryCode(code);
      if (admin.recoveryCodeHashes.includes(h)) {
        const upd = await this.controlDb.adminUser.updateMany({
          where: { id: admin.id, recoveryCodeHashes: { has: h } },
          data: { recoveryCodeHashes: admin.recoveryCodeHashes.filter((x) => x !== h), failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
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

  // ── حساب من: پروفایل و رمز عبور ────────────────────────────────────────

  async me(adminId: string) {
    const a = await this.controlDb.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    return {
      id: a.id,
      name: a.name,
      email: a.email,
      team: a.team,
      totpEnabled: !!a.totpEnabledAt,
      mustChangePassword: a.mustChangePassword,
      lastLoginAt: a.lastLoginAt ?? null,
    };
  }

  /** بررسی رمز فعلی با همان شمارنده/قفل ورود (۵ شکست → ۱۵ دقیقه قفل). */
  private async verifyCurrentPassword(admin: { id: string; email: string; passwordHash: string; failedLoginCount: number; lockedUntil: Date | null }, password: string, ip: string | undefined): Promise<void> {
    this.assertNotLocked(admin);
    if (!(await bcrypt.compare(password, admin.passwordHash))) {
      await this.registerFailure(admin, ip, 'current-password');
      throw new UnauthorizedException('رمز عبور فعلی اشتباه است');
    }
  }

  private audit(adminId: string, action: string, metadata: Record<string, unknown>) {
    return this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId: adminId, action, entityType: 'AdminUser', entityId: adminId, metadata: metadata as never },
    });
  }

  async changePassword(adminId: string, currentPassword: string, newPassword: string, ip?: string): Promise<LoginOk> {
    const a = await this.controlDb.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    await this.verifyCurrentPassword(a, currentPassword, ip);
    const problem = validateAdminPassword(newPassword, { email: a.email, currentPassword });
    if (problem) throw new BadRequestException(problem);
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    // افزایش tokenVersion = ابطال همه‌ی نشست‌ها (از جمله نشست محدود)؛ توکن تازه فقط برای همین نشست برگردانده می‌شود
    const updated = await this.controlDb.adminUser.update({
      where: { id: a.id },
      data: { passwordHash, mustChangePassword: false, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit(a.id, 'admin_user.password_changed', { wasForced: a.mustChangePassword });
    this.events.record({ type: 'PASSWORD_CHANGED', severity: 'INFO', ip, actor: a.id, message: 'admin changed own password; other sessions revoked' });
    return this.issueToken(updated);
  }

  async updateProfile(adminId: string, dto: { name?: string; email?: string; currentPassword?: string }, ip?: string) {
    const a = await this.controlDb.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    const data: { name?: string; email?: string } = {};
    const changed: string[] = [];
    if (dto.name !== undefined && dto.name.trim() && dto.name.trim() !== a.name) {
      data.name = dto.name.trim();
      changed.push('name');
    }
    const newEmail = dto.email?.trim().toLowerCase();
    if (newEmail && newEmail !== a.email.toLowerCase()) {
      if (!dto.currentPassword) throw new BadRequestException('برای تغییر ایمیل، رمز عبور فعلی را وارد کنید');
      await this.verifyCurrentPassword(a, dto.currentPassword, ip);
      const clash = await this.controlDb.adminUser.findFirst({ where: { email: { equals: newEmail, mode: 'insensitive' }, NOT: { id: a.id } }, select: { id: true } });
      if (clash) throw new ConflictException('این ایمیل برای کاربر دیگری ثبت شده است');
      data.email = newEmail;
      changed.push('email');
    }
    if (!changed.length) return this.me(a.id);
    await this.controlDb.adminUser.update({ where: { id: a.id }, data });
    await this.audit(a.id, 'admin_user.profile_updated', { fields: changed, ...(data.email ? { previousEmail: a.email, newEmail: data.email } : {}) });
    return this.me(a.id);
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
    const url = otpauthUrl(a.email, secret);
    // QR سمت سرور و بدون شبکه ساخته می‌شود؛ فقط مسیرهای SVG دارد (بدون متن/اسکریپت)
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, otpauthUrl: url, qrSvg };
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
