import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { AdminJwtPayload } from '../auth/jwt-payload.type.js';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; admin: { id: string; name: string; team: string } }> {
    const admin = await this.controlDb.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }
    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');

    const payload: AdminJwtPayload = { sub: admin.id, team: admin.team, isAdmin: true };
    const accessToken = await this.jwt.signAsync(payload);
    return { accessToken, admin: { id: admin.id, name: admin.name, team: admin.team } };
  }
}
