import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  PERMISSION_GATED_MODULE_CODES,
  fetchModules,
  fetchUserPermissionOverrides,
  saveUserPermissionOverrides,
  ApiError,
  type ModuleCatalogItem,
  type ModulePermissionEntry,
  type TenantRoleWithPermissions,
  type TenantUser,
} from "@/lib/api";

type ActionKey = keyof Omit<ModulePermissionEntry, "moduleCode">;

const ACTIONS: Array<{ key: ActionKey; label: string }> = [
  { key: "canViewAll", label: "مشاهده همه" },
  { key: "canViewOwn", label: "مشاهده خودم" },
  { key: "canCreate", label: "ایجاد" },
  { key: "canEdit", label: "ویرایش" },
  { key: "canDelete", label: "حذف" },
];

const emptyEntry = (moduleCode: string): ModulePermissionEntry => ({
  moduleCode,
  canViewAll: false,
  canViewOwn: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
});

/** اتحاد نقش‌های کاربر روی یک ماژول — همان قاعده‌ی PermissionsService سمت بک‌اند. */
function roleDerived(code: string, user: TenantUser, roles: TenantRoleWithPermissions[]): ModulePermissionEntry {
  const merged = emptyEntry(code);
  for (const role of roles.filter((r) => user.roleIds.includes(r.id))) {
    const p = role.modulePermissions.find((m) => m.moduleCode === code);
    if (!p) continue;
    for (const a of ACTIONS) merged[a.key] = merged[a.key] || p[a.key];
  }
  return merged;
}

export function UserPermissionsModal({
  user,
  roles,
  onClose,
}: {
  user: TenantUser;
  roles: TenantRoleWithPermissions[];
  onClose: () => void;
}) {
  const [catalog, setCatalog] = useState<ModuleCatalogItem[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ModulePermissionEntry> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModules().then(setCatalog).catch(() => setCatalog([]));
    fetchUserPermissionOverrides(user.id)
      // پاسخ سرور فیلد اضافه‌ی userId دارد؛ DTO سمت سرور (forbidNonWhitelisted) هنگام ذخیره‌ی مجدد آن را رد می‌کند.
      .then((list) =>
        setOverrides(
          Object.fromEntries(
            list.map((p) => [
              p.moduleCode,
              {
                moduleCode: p.moduleCode,
                canViewAll: p.canViewAll,
                canViewOwn: p.canViewOwn,
                canCreate: p.canCreate,
                canEdit: p.canEdit,
                canDelete: p.canDelete,
              },
            ]),
          ),
        ),
      )
      .catch(() => setOverrides({}));
  }, [user.id]);

  const rows = useMemo(() => {
    const byCode = new Map((catalog ?? []).map((m) => [m.code, m]));
    return PERMISSION_GATED_MODULE_CODES.filter((code) => {
      const m = byCode.get(code);
      const installed = m && (m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore));
      return installed || overrides?.[code];
    }).map((code) => ({ code, label: byCode.get(code)?.name ?? code }));
  }, [catalog, overrides]);

  function setCustom(code: string, custom: boolean) {
    setOverrides((prev) => {
      const next = { ...(prev ?? {}) };
      if (custom) next[code] = roleDerived(code, user, roles);
      else delete next[code];
      return next;
    });
  }

  function toggle(code: string, key: ActionKey) {
    setOverrides((prev) => {
      const cur = prev?.[code];
      if (!cur) return prev;
      return { ...prev, [code]: { ...cur, [key]: !cur[key] } };
    });
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await saveUserPermissionOverrides(user.id, Object.values(overrides ?? {}));
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره‌سازی با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const loading = catalog === null || overrides === null;

  return (
    <Modal title={`دسترسی دستی «${user.name}»`} onClose={onClose} width="max-w-[760px]">
      <p className="text-[12px] text-muted mb-4 leading-relaxed">
        به‌صورت پیش‌فرض دسترسی این کاربر از نقش‌هایش ({user.roles.join("، ") || "بدون نقش"}) می‌آید. برای هر بخش که
        «دستی» را روشن کنید، دقیقاً همین تیک‌ها جای دسترسی نقش می‌نشیند — هم می‌توانید چیزی اضافه کنید، هم کم.
        مالک و مدیر تننت همیشه دسترسی کامل دارند و از این تنظیم مستثنا هستند.
      </p>
      {loading ? (
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-start text-[11.5px] text-muted font-semibold py-2 px-2">بخش</th>
                <th className="text-center text-[11px] text-muted font-semibold py-2 px-1.5">دستی</th>
                {ACTIONS.map((a) => (
                  <th key={a.key} className="text-center text-[11px] text-muted font-semibold py-2 px-1.5">
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const custom = overrides![m.code];
                const shown = custom ?? roleDerived(m.code, user, roles);
                return (
                  <tr key={m.code} className={`border-b border-border ${custom ? "bg-primary-soft/40" : ""}`}>
                    <td className="py-2.5 px-2 text-[12.5px] font-bold">{m.label}</td>
                    <td className="text-center py-2.5 px-1.5">
                      <input
                        type="checkbox"
                        checked={!!custom}
                        onChange={() => setCustom(m.code, !custom)}
                        className="w-4 h-4 accent-primary cursor-pointer"
                        aria-label={`دسترسی دستی برای ${m.label}`}
                      />
                    </td>
                    {ACTIONS.map((a) => (
                      <td key={a.key} className="text-center py-2.5 px-1.5">
                        <input
                          type="checkbox"
                          checked={shown[a.key]}
                          disabled={!custom}
                          onChange={() => toggle(m.code, a.key)}
                          className="w-4 h-4 accent-primary cursor-pointer disabled:opacity-40 disabled:cursor-default"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error ? <div className="text-[12px] text-danger mt-3">{error}</div> : null}
      <button
        onClick={handleSave}
        disabled={submitting || loading}
        className="mt-4 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
      >
        {submitting ? "در حال ذخیره..." : "ذخیره‌ی دسترسی‌های دستی"}
      </button>
    </Modal>
  );
}
