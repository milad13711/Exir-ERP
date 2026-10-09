import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { ExirSmsService } from './exir-sms.service.js';
import { TenantSmsService } from './tenant-sms.service.js';
import { SetSmsConnectionDto } from './dto/set-sms-connection.dto.js';
import { assertTwoFactorForSensitiveAction } from '../auth/tenant-two-factor-policy.js';

/** اتصال پنل پیامکی تننت، مانده‌ی اعتبار (هدر) و خرید بسته‌ی پیامکی پنل سیستمی. */
@Controller('sms-panel')
@UseGuards(JwtAuthGuard)
export class SmsPanelController {
  constructor(
    private readonly tenantSms: TenantSmsService,
    private readonly gateway: ExirSmsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  /** وضعیت اتصال + مانده‌ی اعتبار — برای چیپ هدر و صفحه‌ی تنظیمات. کلید API هرگز برنمی‌گردد. */
  @Get('status')
  async status(@Ctx() ctx: TenantRequestContext) {
    const conn = await this.tenantSms.getConnection(ctx.tenantDb);
    if (conn.mode === 'OWN') {
      const credit = await this.gateway.getCredit(conn.apiKey);
      return {
        mode: 'OWN' as const,
        senderNumber: conn.senderNumber,
        smsCount: credit.success ? credit.smsCount : null,
        error: credit.success ? null : credit.error,
      };
    }
    if (conn.mode === 'SYSTEM') {
      return { mode: 'SYSTEM' as const, smsCount: await this.tenantSms.getWalletCredits(ctx.tenantId), error: null };
    }
    if (conn.mode === 'LEGACY') return { mode: 'LEGACY' as const, smsCount: null, error: null };
    return { mode: 'NONE' as const, smsCount: null, error: null };
  }

  @Put('connection')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async setConnection(@Body() dto: SetSmsConnectionDto, @Ctx() ctx: TenantRequestContext) {
    assertTwoFactorForSensitiveAction(ctx);
    if (dto.mode === 'OWN') {
      if (!dto.apiKey?.trim() || !dto.senderNumber?.trim()) {
        throw new BadRequestException('کلید API و شماره‌ی ارسال پنل را وارد کنید');
      }
      const check = await this.gateway.getCredit(dto.apiKey.trim());
      if (!check.success) throw new BadRequestException(`اتصال به پنل برقرار نشد: ${check.error}`);
      await this.tenantSms.setConnection(ctx.tenantDb, { mode: 'OWN', apiKey: dto.apiKey.trim(), senderNumber: dto.senderNumber.trim() });
    } else if (dto.mode === 'SYSTEM') {
      await this.tenantSms.setConnection(ctx.tenantDb, { mode: 'SYSTEM', tenantId: ctx.tenantId });
    } else {
      await this.tenantSms.setConnection(ctx.tenantDb, { mode: 'NONE' });
    }
    return this.status(ctx);
  }

  /** بسته‌های قابل خرید — فقط فعال و با قیمت مشخص‌شده توسط مدیر پلتفرم. */
  @Get('packages')
  packages() {
    return this.controlDb.smsPackage.findMany({
      where: { isActive: true, priceToman: { gt: 0 } },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, credits: true, priceToman: true },
    });
  }

  /** سبد خرید → فاکتور SMS_PACKAGE؛ پرداخت با همان جریان فاکتور (POST /public/invoices/:id/pay) و شارژ آنی بعد از تأیید درگاه. */
  @Post('packages/:code/purchase')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async purchase(@Param('code') code: string, @Ctx() ctx: TenantRequestContext) {
    const pkg = await this.controlDb.smsPackage.findUnique({ where: { code } });
    if (!pkg || !pkg.isActive || pkg.priceToman <= 0) throw new NotFoundException('این بسته در دسترس نیست');
    const invoice = await this.controlDb.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        amount: pkg.priceToman,
        purpose: 'SMS_PACKAGE',
        items: { packageCode: pkg.code, credits: pkg.credits, name: `بسته‌ی ${pkg.credits.toLocaleString('en-US')} پیامکی` },
        status: 'PENDING',
        dueAt: new Date(),
      },
    });
    // خرید بسته یعنی استفاده از پنل سیستمی؛ پنل اختصاصیِ متصل را تغییر نمی‌دهیم.
    const conn = await this.tenantSms.getConnection(ctx.tenantDb);
    if (conn.mode !== 'OWN' && conn.mode !== 'SYSTEM') {
      await this.tenantSms.setConnection(ctx.tenantDb, { mode: 'SYSTEM', tenantId: ctx.tenantId });
    }
    return { invoiceId: invoice.id, amount: invoice.amount };
  }
}
