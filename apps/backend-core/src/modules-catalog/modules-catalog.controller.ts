import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import type { ModuleDefinition, TenantModule } from '../../generated/control-client/index.js';
import { CheckoutDto } from './dto/checkout.dto.js';
import { modulePriceForMode } from './module-pricing.js';

/**
 * The in-app module store: every tenant sees the full catalog with their own
 * install status layered on top. OWNER/ADMIN members can install/uninstall
 * a free (or already-owned, still-in-period) module themselves instantly;
 * a genuinely new paid purchase must go through the cart/checkout endpoint
 * below and only activates once its invoice is PAID (see
 * TenantsService.settleInvoicePaid) — never on click, unlike the old
 * one-module-at-a-time flow. Prerequisites (dependsOn) are enforced both on
 * instant-install and at checkout time.
 */
@Controller('modules')
@UseGuards(JwtAuthGuard)
export class ModulesCatalogController {
  constructor(private readonly controlDb: ControlPrismaService) {}

  @Get()
  async list(@Ctx() ctx: TenantRequestContext) {
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany({ orderBy: { createdAt: 'asc' } }),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const installedByModuleId = new Map(installed.map((m) => [m.moduleId, m]));
    // ماژول‌های isListed=false (مثل book-store) از کاتالوگ عمومی حذف می‌شوند —
    // مگر برای تننتی که از قبل یک ردیف TenantModule برایش دارد (هر وضعیتی)،
    // چون آن تننت باید بتواند وضعیت/تنظیمات ماژول نصب‌شده‌اش را همچنان ببیند.
    // نصب/دسترسی خودِ ماژول (ModuleGuard، install/uninstall) کاملاً دست‌نخورده
    // می‌ماند — این فیلتر فقط روی همین فهرست است.
    return catalog
      .filter((m) => m.isListed || installedByModuleId.has(m.id))
      .map((m) => {
        const install = installedByModuleId.get(m.id);
        return {
          ...m,
          installStatus: install?.status ?? null,
          billingMode: install?.billingMode ?? null,
          currentPeriodEnd: install?.currentPeriodEnd ?? null,
          demoAvailable: !install?.trialRecordCreatedAt,
        };
      });
  }

  /** فعال بودن رایگان/بدون نیاز به خرید جدید — ماژول رایگان/هسته، لایسنس قبلاً خریداری‌شده، یا هنوز داخل دوره‌ی پرداخت‌شده. */
  private canFreeActivate(module: ModuleDefinition, existing: TenantModule | undefined): boolean {
    if (module.priceMonthly === 0) return true;
    if (!existing) return false;
    if (existing.billingMode === 'LICENSE') return true;
    if (existing.currentPeriodEnd && existing.currentPeriodEnd.getTime() > Date.now()) return true;
    return false;
  }

  @Post(':code/install')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async install(@Param('code') code: string, @Ctx() ctx: TenantRequestContext) {
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany(),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const byCode = new Map(catalog.map((m) => [m.code, m]));
    const module = byCode.get(code);
    if (!module) throw new NotFoundException('ماژول یافت نشد');

    const installedByModuleId = new Map(installed.map((m) => [m.moduleId, m]));
    const isActive = (m: ModuleDefinition) => {
      const install = installedByModuleId.get(m.id);
      return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : m.isCore;
    };

    const existing = installedByModuleId.get(module.id);
    if (!this.canFreeActivate(module, existing)) {
      throw new BadRequestException(
        'این ماژول باید از طریق سبد خرید تهیه شود — از فروشگاه ماژول به سبد خرید اضافه و پرداخت کنید.',
      );
    }

    const missingDeps = module.dependsOn
      .map((depCode) => byCode.get(depCode))
      .filter((dep): dep is ModuleDefinition => !!dep && !isActive(dep));
    if (missingDeps.length > 0) {
      throw new BadRequestException(
        `ابتدا این ماژول‌ها را فعال کنید: ${missingDeps.map((d) => d.name).join('، ')}`,
      );
    }

    const tenantModule = await this.controlDb.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: ctx.tenantId, moduleId: module.id } },
      create: { tenantId: ctx.tenantId, moduleId: module.id, status: 'INSTALLED' },
      update: { status: 'INSTALLED' },
    });

    await this.controlDb.auditLog.create({
      data: {
        actorType: 'global_user',
        actorId: ctx.auth.sub,
        tenantId: ctx.tenantId,
        action: 'module.installed',
        entityType: 'ModuleDefinition',
        entityId: module.id,
        metadata: { code: module.code },
      },
    });

    return { ...module, installStatus: tenantModule.status };
  }

  @Post(':code/uninstall')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async uninstall(@Param('code') code: string, @Ctx() ctx: TenantRequestContext) {
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany(),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const byCode = new Map(catalog.map((m) => [m.code, m]));
    const module = byCode.get(code);
    if (!module) throw new NotFoundException('ماژول یافت نشد');

    const installedByModuleId = new Map<string, TenantModule>(installed.map((m) => [m.moduleId, m]));
    const isActive = (m: ModuleDefinition) => {
      const install = installedByModuleId.get(m.id);
      return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : m.isCore;
    };

    const blockedBy = catalog.filter(
      (m) => m.code !== module.code && m.dependsOn.includes(module.code) && isActive(m),
    );
    if (blockedBy.length > 0) {
      throw new BadRequestException(
        `این ماژول پیش‌نیاز ماژول‌های فعال دیگری است، ابتدا آن‌ها را غیرفعال کنید: ${blockedBy.map((d) => d.name).join('، ')}`,
      );
    }

    const tenantModule = await this.controlDb.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: ctx.tenantId, moduleId: module.id } },
      create: { tenantId: ctx.tenantId, moduleId: module.id, status: 'DISABLED' },
      update: { status: 'DISABLED' },
    });

    await this.controlDb.auditLog.create({
      data: {
        actorType: 'global_user',
        actorId: ctx.auth.sub,
        tenantId: ctx.tenantId,
        action: 'module.uninstalled',
        entityType: 'ModuleDefinition',
        entityId: module.id,
        metadata: { code: module.code },
      },
    });

    return { ...module, installStatus: tenantModule.status };
  }

  /**
   * شروع نسخه‌ی آزمایشی/دمو — هر ماژول در کل عمر این تننت فقط یک بار قابل
   * دمو کردن است (trialRecordCreatedAt). با ثبت اولین رکورد (اولین POST به
   * روت‌های همان ماژول) ModuleGuard خودش این را به‌صورت خودکار غیرفعال می‌کند.
   */
  @Post(':code/demo/activate')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async activateDemo(@Param('code') code: string, @Ctx() ctx: TenantRequestContext) {
    const module = await this.controlDb.moduleDefinition.findUnique({ where: { code } });
    if (!module) throw new NotFoundException('ماژول یافت نشد');

    const existing = await this.controlDb.tenantModule.findUnique({
      where: { tenantId_moduleId: { tenantId: ctx.tenantId, moduleId: module.id } },
    });
    if (existing?.trialRecordCreatedAt) {
      throw new BadRequestException('نسخه‌ی آزمایشی این ماژول قبلاً استفاده شده است');
    }
    if (existing && (existing.status === 'INSTALLED' || existing.status === 'TRIAL')) {
      throw new BadRequestException('این ماژول همین حالا فعال است');
    }

    const tenantModule = await this.controlDb.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: ctx.tenantId, moduleId: module.id } },
      create: { tenantId: ctx.tenantId, moduleId: module.id, status: 'TRIAL', trialActivatedAt: new Date() },
      update: { status: 'TRIAL', trialActivatedAt: new Date() },
    });

    return { ...module, installStatus: tenantModule.status };
  }

  /**
   * سبد خرید: چند ماژول با هم، هر کدام با دوره‌ی خودش (ماهانه/سالانه/لایسنس)،
   * در قالب یک فاکتور واحد. فعال‌سازی واقعی فقط بعد از پرداخت این فاکتور رخ
   * می‌دهد — TenantsService.settleInvoicePaid.
   */
  @Post('checkout')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async checkout(@Body() dto: CheckoutDto, @Ctx() ctx: TenantRequestContext) {
    const codes = dto.items.map((i) => i.code);
    const [catalog, installed] = await Promise.all([
      this.controlDb.moduleDefinition.findMany(),
      this.controlDb.tenantModule.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    const byCode = new Map(catalog.map((m) => [m.code, m]));
    const installedByModuleId = new Map(installed.map((m) => [m.moduleId, m]));
    const inCart = new Set(codes);
    const isActive = (m: ModuleDefinition) => {
      if (inCart.has(m.code)) return true;
      const install = installedByModuleId.get(m.id);
      return install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : m.isCore;
    };

    const lineItems: { moduleCode: string; moduleName: string; billingMode: string; amount: number }[] = [];
    for (const item of dto.items) {
      const module = byCode.get(item.code);
      if (!module) throw new NotFoundException(`ماژول «${item.code}» یافت نشد`);
      if (module.priceMonthly === 0) {
        throw new BadRequestException(`ماژول «${module.name}» رایگان است و نیازی به خرید ندارد`);
      }
      const missingDeps = module.dependsOn
        .map((depCode) => byCode.get(depCode))
        .filter((dep): dep is ModuleDefinition => !!dep && !isActive(dep));
      if (missingDeps.length > 0) {
        throw new BadRequestException(
          `برای «${module.name}» ابتدا این ماژول‌ها باید فعال یا هم‌زمان در سبد خرید باشند: ${missingDeps.map((d) => d.name).join('، ')}`,
        );
      }
      lineItems.push({
        moduleCode: module.code,
        moduleName: module.name,
        billingMode: item.billingMode,
        amount: modulePriceForMode(module, item.billingMode),
      });
    }

    const amount = lineItems.reduce((sum, i) => sum + i.amount, 0);
    const invoice = await this.controlDb.invoice.create({
      data: {
        tenantId: ctx.tenantId,
        amount,
        purpose: 'MODULE_PURCHASE',
        items: lineItems,
        status: 'PENDING',
        dueAt: new Date(),
      },
    });

    await this.controlDb.auditLog.create({
      data: {
        actorType: 'global_user',
        actorId: ctx.auth.sub,
        tenantId: ctx.tenantId,
        action: 'module.checkout_started',
        entityType: 'Invoice',
        entityId: invoice.id,
        metadata: { items: lineItems },
      },
    });

    return { invoiceId: invoice.id };
  }
}
