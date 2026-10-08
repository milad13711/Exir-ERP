import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { SecurityEventsService } from '../security/security-events.service.js';
import { generateOneTimePassword } from './admin-password-policy.js';
import type { StaffTeam } from '../../generated/control-client/index.js';

const BCRYPT_COST = 12;

/**
 * مدیریت کاربران پلتفرم (فقط SUPER_ADMIN، توسط کنترلر تضمین می‌شود).
 * رمزهای تولیدی فقط در پاسخ همان درخواست برمی‌گردند؛ نه ذخیره‌ی متن ساده، نه لاگ، نه AuditLog.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly events: SecurityEventsService,
  ) {}

  list() {
    return this.controlDb.adminUser
      .findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true, email: true, team: true, isActive: true, totpEnabledAt: true, lastLoginAt: true, mustChangePassword: true, createdAt: true } })
      .then((rows) => rows.map((r) => ({ id: r.id, name: r.name, email: r.email, team: r.team, totpEnabled: !!r.totpEnabledAt, lastLoginAt: r.lastLoginAt, disabled: !r.isActive, mustChangePassword: r.mustChangePassword, createdAt: r.createdAt })));
  }

  private audit(actorId: string, action: string, targetId: string, metadata: Record<string, unknown> = {}) {
    return this.controlDb.auditLog.create({
      data: { actorType: 'admin_user', actorId, action, entityType: 'AdminUser', entityId: targetId, metadata: metadata as never },
    });
  }

  private async get(id: string) {
    const u = await this.controlDb.adminUser.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('کاربر یافت نشد');
    return u;
  }

  /** آیا پس از حذف/تنزل این کاربر هنوز حداقل یک SUPER_ADMIN فعال می‌ماند؟ */
  private async otherActiveSuperAdmins(excludeId: string): Promise<number> {
    return this.controlDb.adminUser.count({ where: { team: 'SUPER_ADMIN', isActive: true, id: { not: excludeId } } });
  }

  async create(actorId: string, dto: { name: string; email: string; team: StaffTeam }) {
    const email = dto.email.trim().toLowerCase();
    const clash = await this.controlDb.adminUser.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (clash) throw new ConflictException('این ایمیل قبلاً ثبت شده است');
    const password = generateOneTimePassword(email);
    const u = await this.controlDb.adminUser.create({
      data: { name: dto.name.trim(), email, team: dto.team, passwordHash: await bcrypt.hash(password, BCRYPT_COST), mustChangePassword: true, isActive: true },
    });
    await this.audit(actorId, 'admin_user.created', u.id, { email: u.email, team: u.team });
    return { id: u.id, email: u.email, team: u.team, oneTimePassword: password };
  }

  async resetPassword(actorId: string, id: string) {
    if (id === actorId) throw new BadRequestException('رمز خودتان را از «حساب من» تغییر دهید');
    const u = await this.get(id);
    const password = generateOneTimePassword(u.email);
    await this.controlDb.adminUser.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(password, BCRYPT_COST), mustChangePassword: true, tokenVersion: { increment: 1 }, failedLoginCount: 0, lockedUntil: null },
    });
    await this.audit(actorId, 'admin_user.password_reset', id, { email: u.email });
    this.events.record({ type: 'SESSIONS_INVALIDATED', severity: 'WARNING', actor: actorId, message: 'admin password reset by super admin; sessions revoked', context: { adminId: id } });
    return { id, oneTimePassword: password };
  }

  async setActive(actorId: string, id: string, active: boolean) {
    const u = await this.get(id);
    if (!active) {
      if (id === actorId) throw new BadRequestException('نمی‌توانید حساب خودتان را غیرفعال کنید');
      if (u.team === 'SUPER_ADMIN' && u.isActive && (await this.otherActiveSuperAdmins(id)) === 0) throw new BadRequestException('آخرین مدیر ارشد فعال را نمی‌توان غیرفعال کرد');
    }
    await this.controlDb.adminUser.update({ where: { id }, data: active ? { isActive: true } : { isActive: false, tokenVersion: { increment: 1 } } });
    await this.audit(actorId, active ? 'admin_user.enabled' : 'admin_user.disabled', id, { email: u.email });
    if (!active) this.events.record({ type: 'SESSIONS_INVALIDATED', severity: 'WARNING', actor: actorId, message: 'admin disabled; sessions revoked', context: { adminId: id } });
    return { id, disabled: !active };
  }

  async setTeam(actorId: string, id: string, team: StaffTeam) {
    const u = await this.get(id);
    if (u.team === team) return { id, team };
    if (u.team === 'SUPER_ADMIN') {
      if (id === actorId) throw new BadRequestException('نمی‌توانید نقش خودتان را تنزل دهید');
      if (u.isActive && (await this.otherActiveSuperAdmins(id)) === 0) throw new BadRequestException('آخرین مدیر ارشد فعال را نمی‌توان تنزل داد');
    }
    await this.controlDb.adminUser.update({ where: { id }, data: { team, tokenVersion: { increment: 1 } } });
    await this.audit(actorId, 'admin_user.team_changed', id, { from: u.team, to: team });
    return { id, team };
  }
}
