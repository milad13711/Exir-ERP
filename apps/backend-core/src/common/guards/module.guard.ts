import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ControlPrismaService } from '../../prisma/control-prisma.service.js';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator.js';

/**
 * اجرا فقط روی روت‌هایی که @RequireModule دارند (بعد از JwtAuthGuard در
 * همان @UseGuards، چون به req.ctx نیاز دارد).
 *
 * منطق فعال‌بودن: اگر یک ردیف TenantModule برای این تننت/ماژول وجود دارد،
 * فقط وضعیت INSTALLED/TRIAL آن معتبر است — یعنی حتی ماژول isCore هم با
 * یک ردیف DISABLED صریح واقعاً مسدود می‌شود (تننت خودش خاموشش کرده).
 * اگر هیچ ردیفی وجود ندارد، پیش‌فرض بر اساس isCore تعیین می‌شود: ماژول
 * هسته بدون هیچ اقدامی فعال است، ماژول پولی بدون خرید غیرفعال است.
 *
 * وابستگی‌ها (dependsOn) از خود دیتابیس خوانده می‌شوند، نه یک نگاشت ثابت
 * در کد — و به‌صورت انتقالی (transitive) دنبال می‌شوند، چون مثلاً «چک»
 * به «فروش» وابسته است و «فروش» خودش به «حسابداری» وابسته است.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly controlDb: ControlPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const moduleCode = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!moduleCode) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const tenantId = req.ctx?.tenantId;
    if (!tenantId) return true; // نبود ctx یعنی JwtAuthGuard اجرا نشده یا مسیر تننت‌محور نیست — کار این گارد نیست

    const allModules = await this.controlDb.moduleDefinition.findMany();
    const byCode = new Map(allModules.map((m) => [m.code, m]));
    const codesToCheck = this.collectTransitiveDeps(moduleCode, byCode);

    const installs = await this.controlDb.tenantModule.findMany({
      where: { tenantId, moduleId: { in: [...byCode.values()].map((m) => m.id) } },
    });
    const installByModuleId = new Map(installs.map((i) => [i.moduleId, i]));

    for (const code of codesToCheck) {
      const module = byCode.get(code);
      if (!module) continue; // کد ناشناخته را مسدود نمی‌کنیم — به‌جای شکستن دسترسی، فقط گیت نمی‌زنیم
      const install = installByModuleId.get(module.id);
      const allowed = install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : module.isCore;
      if (!allowed) {
        throw new ForbiddenException(
          `ماژول «${module.name}» برای این محیط کاری فعال نیست — از فروشگاه ماژول‌ها فعالش کنید یا با پشتیبانی تماس بگیرید.`,
        );
      }
    }
    return true;
  }

  private collectTransitiveDeps(
    rootCode: string,
    byCode: Map<string, { code: string; dependsOn: string[] }>,
  ): string[] {
    const seen = new Set<string>();
    const queue = [rootCode];
    while (queue.length > 0) {
      const code = queue.shift()!;
      if (seen.has(code)) continue;
      seen.add(code);
      const module = byCode.get(code);
      if (module) queue.push(...module.dependsOn);
    }
    return [...seen];
  }
}
