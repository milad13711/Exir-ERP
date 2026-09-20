import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { AdminTeamsGuard } from '../common/guards/admin-teams.guard.js';
import { AdminTeams } from '../common/decorators/admin-teams.decorator.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { UpdateSmsPackageDto } from './dto/update-sms-package.dto.js';

/** قیمت‌گذاری بسته‌های پیامکی پنل سیستمی (۵۰۰ / ۱۰۰۰ / ۵۰۰۰) — فقط مدیران پلتفرم. */
@Controller('admin/sms-packages')
@UseGuards(AdminJwtAuthGuard, AdminTeamsGuard)
export class AdminSmsPackagesController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get()
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  list() {
    return this.controlDb.smsPackage.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  @Put(':code')
  @AdminTeams('SUPER_ADMIN', 'BILLING')
  update(@Param('code') code: string, @Body() dto: UpdateSmsPackageDto) {
    return this.controlDb.smsPackage.update({
      where: { code },
      data: { priceToman: dto.priceToman, isActive: dto.isActive },
    });
  }
}
