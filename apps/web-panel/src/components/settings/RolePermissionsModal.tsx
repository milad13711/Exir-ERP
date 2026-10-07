import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  PERMISSION_GATED_MODULE_CODES,
  fetchModules,
  updateRolePermissions,
  ApiError,
  type ModuleCatalogItem,
  type TenantRoleWithPermissions,
  type ModulePermissionEntry,
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

export function RolePermissionsModal({
  role,
  onClose,
  onSaved,
}: {
  role: TenantRoleWithPermissions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalog, setCatalog] = useState<ModuleCatalogItem[] | null>(null);
  const [matrix, setMatrix] = useState<Record<string, ModulePermissionEntry>>(() =>
    Object.fromEntries(role.modulePermissions.map((p) => [p.moduleCode, p])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModules().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  // فقط ماژول‌های گیت‌شده با ماتریس که برای این تننت نصب‌اند (یا نقش از قبل برایشان
  // دسترسی دارد) — ماژول تازه‌نصب‌شده خودکار اینجا ظاهر می‌شود.
  const rows = useMemo(() => {
    const byCode = new Map((catalog ?? []).map((m) => [m.code, m]));
    return PERMISSION_GATED_MODULE_CODES.filter((code) => {
      const m = byCode.get(code);
      const installed = m && (m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore));
      return code === "logs" || installed || role.modulePermissions.some((p) => p.moduleCode === code);
    }).map((code) => ({ code, label: code === "logs" ? "لاگ فعالیت‌ها (مشاهده‌ی همه = دیدن فعالیت همه‌ی افراد)" : (byCode.get(code)?.name ?? code) }));
  }, [catalog, role.modulePermissions]);

  const entryOf = (code: string) => matrix[code] ?? emptyEntry(code);

  function toggle(code: string, key: ActionKey) {
    setMatrix((prev) => {
      const cur = prev[code] ?? emptyEntry(code);
      return { ...prev, [code]: { ...cur, [key]: !cur[key] } };
    });
  }

  function setRowAll(code: string, value: boolean) {
    setMatrix((prev) => ({
      ...prev,
      [code]: { ...emptyEntry(code), canViewAll: value, canViewOwn: value, canCreate: value, canEdit: value, canDelete: value },
    }));
  }

  function setColumnAll(key: ActionKey, value: boolean) {
    setMatrix((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.code] = { ...(next[r.code] ?? emptyEntry(r.code)), [key]: value };
      return next;
    });
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await updateRolePermissions(
        role.id,
        rows.map((r) => entryOf(r.code)),
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره‌سازی با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`سطح دسترسی نقش «${role.name}»`} onClose={onClose} width="max-w-[720px]">
      <p className="text-[12px] text-muted mb-4">
        مشخص کنید کاربران این نقش در هر بخش چه کاری می‌توانند انجام دهند. «مشاهده خودم» یعنی فقط رکوردهایی که
        خودشان ثبت کرده‌اند را می‌بینند. فقط ماژول‌های نصب‌شده‌ی این محیط کاری نمایش داده می‌شوند — با نصب
        هر ماژول جدید، همین‌جا ردیف آن ظاهر می‌شود.
      </p>
      {catalog === null ? (
        <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full border-collapse min-w-[560px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-start text-[11.5px] text-muted font-semibold py-2 px-2">بخش</th>
                {ACTIONS.map((a) => {
                  const allOn = rows.length > 0 && rows.every((r) => entryOf(r.code)[a.key]);
                  return (
                    <th key={a.key} className="text-center text-[11px] text-muted font-semibold py-2 px-1.5">
                      <label className="flex flex-col items-center gap-1 cursor-pointer">
                        {a.label}
                        <input
                          type="checkbox"
                          checked={allOn}
                          onChange={() => setColumnAll(a.key, !allOn)}
                          className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          aria-label={`${a.label} برای همه‌ی بخش‌ها`}
                        />
                      </label>
                    </th>
                  );
                })}
                <th className="text-center text-[11px] text-muted font-semibold py-2 px-1.5">همه</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const entry = entryOf(m.code);
                const rowAll = ACTIONS.every((a) => entry[a.key]);
                return (
                  <tr key={m.code} className="border-b border-border">
                    <td className="py-2.5 px-2 text-[12.5px] font-bold">{m.label}</td>
                    {ACTIONS.map((a) => (
                      <td key={a.key} className="text-center py-2.5 px-1.5">
                        <input
                          type="checkbox"
                          checked={entry[a.key]}
                          onChange={() => toggle(m.code, a.key)}
                          className="w-4 h-4 accent-primary cursor-pointer"
                        />
                      </td>
                    ))}
                    <td className="text-center py-2.5 px-1.5">
                      <input
                        type="checkbox"
                        checked={rowAll}
                        onChange={() => setRowAll(m.code, !rowAll)}
                        className="w-4 h-4 accent-primary cursor-pointer"
                        aria-label={`دسترسی کامل به ${m.label}`}
                      />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={ACTIONS.length + 2} className="py-6 text-center text-muted text-sm">
                    ماژولی برای تنظیم دسترسی نصب نشده است
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {error ? <div className="text-[12px] text-danger mt-3">{error}</div> : null}
      <button
        onClick={handleSave}
        disabled={submitting || catalog === null}
        className="mt-4 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
      >
        {submitting ? "در حال ذخیره..." : "ذخیره‌ی سطح دسترسی"}
      </button>
    </Modal>
  );
}
