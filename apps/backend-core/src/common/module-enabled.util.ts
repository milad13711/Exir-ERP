import type { ControlPrismaService } from '../prisma/control-prisma.service.js';

/**
 * آیا ماژول برای این تننت فعال است؟ همان منطق ModuleGuard (ردیف صریح TenantModule اولویت دارد،
 * وگرنه isCore؛ وابستگی‌ها انتقالی بررسی می‌شوند) ولی بدون اثر جانبی (مثل مصرف رکورد دمو).
 */
export async function isModuleEnabled(controlDb: ControlPrismaService, tenantId: string, code: string): Promise<boolean> {
  const all = await controlDb.moduleDefinition.findMany();
  const byCode = new Map(all.map((m) => [m.code, m]));
  if (!byCode.has(code)) return false;
  const seen = new Set<string>();
  const queue = [code];
  while (queue.length) {
    const c = queue.shift()!;
    if (seen.has(c)) continue;
    seen.add(c);
    const m = byCode.get(c);
    if (m) queue.push(...m.dependsOn);
  }
  const installs = await controlDb.tenantModule.findMany({ where: { tenantId, moduleId: { in: all.map((m) => m.id) } } });
  const byModuleId = new Map(installs.map((i) => [i.moduleId, i]));
  for (const c of seen) {
    const m = byCode.get(c);
    if (!m) continue;
    const install = byModuleId.get(m.id);
    const ok = install ? install.status === 'INSTALLED' || install.status === 'TRIAL' : m.isCore;
    if (!ok) return false;
  }
  return true;
}
