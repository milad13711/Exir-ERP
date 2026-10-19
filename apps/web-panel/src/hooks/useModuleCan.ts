"use client";

import { useWorkspace } from "@/lib/workspace-context";

/**
 * دسترسی‌های کاربر روی یک ماژول برای نمایش/پنهان‌کردن دکمه‌ها. فقط راحتی رابط است؛
 * اجبار واقعی همیشه سمت سرور (PermissionsService) انجام می‌شود.
 */
export function useModuleCan(moduleCode: string) {
  const { me } = useWorkspace();
  const p = me?.permissions;
  if (!p || p.manager) return { manager: !p || p.manager, canCreate: true, canEdit: true, canDelete: true };
  const m = p.modules[moduleCode];
  return { manager: false, canCreate: !!m?.canCreate, canEdit: !!m?.canEdit, canDelete: !!m?.canDelete };
}
