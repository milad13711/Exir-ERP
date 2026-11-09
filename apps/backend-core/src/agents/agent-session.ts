import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { isAllowedForAgentSession } from './agent-session-policy.js';

const TTL_MS = 30_000;
const MAX = 5_000;
const cache = new Map<string, { at: number; v: boolean }>();

export function invalidateAgentSessionCache(): void {
  cache.clear();
}

/** کاربر «فقط نماینده» است: حداقل یک نقش دارد و همه‌ی نقش‌هایش isAgentRole اند (کارمندی که نماینده هم هست محدود نمی‌شود). */
export async function isAgentOnlyUser(tenantDb: TenantPrismaClient, tenantId: string, globalUserId: string, now = Date.now()): Promise<boolean> {
  const k = `${tenantId}:${globalUserId}`;
  const hit = cache.get(k);
  if (hit && now - hit.at < TTL_MS) return hit.v;
  const role = (tenantDb as unknown as { role?: TenantPrismaClient['role'] }).role;
  if (!role?.findMany) return false; // کلاینت ناقص (تست)؛ هرگز در اجرای واقعی رخ نمی‌دهد
  let v = false;
  try {
    const roles = await role.findMany({ where: { users: { some: { user: { globalUserId } } } }, select: { isAgentRole: true } });
    v = roles.length > 0 && roles.every((r) => r.isAgentRole);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'P2021' || code === 'P2022') return false; // مهاجرت این تننت هنوز اجرا نشده → ماژول نمایندگی در آن معنا ندارد
    throw new ServiceUnavailableException('بررسی سطح دسترسی موقتاً ممکن نیست');
  }
  if (cache.size >= MAX) cache.clear();
  cache.set(k, { at: now, v });
  return v;
}

/** اعمال سیاست نشست نماینده؛ برای مدیران (OWNER/ADMIN) و کلید API فراخوانی نمی‌شود. */
export async function enforceAgentSession(tenantDb: TenantPrismaClient, tenantId: string, globalUserId: string, method: string, fullPath: string): Promise<void> {
  if (!(await isAgentOnlyUser(tenantDb, tenantId, globalUserId))) return;
  if (!isAllowedForAgentSession(method, fullPath)) throw new ForbiddenException('حساب نماینده فقط به نمایندگی، لیست کار روزانه، وظایف و یادآوری، پیام‌رسان داخلی و کارتابل تأیید دسترسی دارد');
}
