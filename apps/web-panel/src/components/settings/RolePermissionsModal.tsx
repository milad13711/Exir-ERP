import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  PERMISSION_MODULES,
  updateRolePermissions,
  ApiError,
  type TenantRoleWithPermissions,
  type ModulePermissionEntry,
} from "@/lib/api";

const ACTIONS: Array<{ key: keyof Omit<ModulePermissionEntry, "moduleCode">; label: string }> = [
  { key: "canViewAll", label: "مشاهده همه" },
  { key: "canViewOwn", label: "مشاهده خودم" },
  { key: "canCreate", label: "ایجاد" },
  { key: "canEdit", label: "ویرایش" },
  { key: "canDelete", label: "حذف" },
];

function buildInitialMatrix(role: TenantRoleWithPermissions): Record<string, ModulePermissionEntry> {
  const map: Record<string, ModulePermissionEntry> = {};
  for (const m of PERMISSION_MODULES) {
    const existing = role.modulePermissions.find((p) => p.moduleCode === m.code);
    map[m.code] = existing ?? {
      moduleCode: m.code,
      canViewAll: false,
      canViewOwn: false,
      canCreate: false,
      canEdit: false,
      canDelete: false,
    };
  }
  return map;
}

export function RolePermissionsModal({
  role,
  onClose,
  onSaved,
}: {
  role: TenantRoleWithPermissions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [matrix, setMatrix] = useState(() => buildInitialMatrix(role));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(moduleCode: string, key: keyof Omit<ModulePermissionEntry, "moduleCode">) {
    setMatrix((prev) => ({
      ...prev,
      [moduleCode]: { ...prev[moduleCode], [key]: !prev[moduleCode][key] },
    }));
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    try {
      await updateRolePermissions(role.id, Object.values(matrix));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره‌سازی با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`سطح دسترسی نقش «${role.name}»`} onClose={onClose} width="max-w-[640px]">
      <p className="text-[12px] text-muted mb-4">
        مشخص کنید کاربران این نقش در هر بخش چه کاری می‌توانند انجام دهند. «مشاهده خودم» یعنی فقط رکوردهایی که
        خودشان ثبت کرده‌اند را می‌بینند.
      </p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full border-collapse min-w-[520px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-start text-[11.5px] text-muted font-semibold py-2 px-2">بخش</th>
              {ACTIONS.map((a) => (
                <th key={a.key} className="text-center text-[11px] text-muted font-semibold py-2 px-1.5">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((m) => (
              <tr key={m.code} className="border-b border-border">
                <td className="py-2.5 px-2 text-[12.5px] font-bold">{m.label}</td>
                {ACTIONS.map((a) => (
                  <td key={a.key} className="text-center py-2.5 px-1.5">
                    <input
                      type="checkbox"
                      checked={matrix[m.code][a.key]}
                      onChange={() => toggle(m.code, a.key)}
                      className="w-4 h-4 accent-primary cursor-pointer"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <div className="text-[12px] text-danger mt-3">{error}</div> : null}
      <button
        onClick={handleSave}
        disabled={submitting}
        className="mt-4 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
      >
        {submitting ? "در حال ذخیره..." : "ذخیره‌ی سطح دسترسی"}
      </button>
    </Modal>
  );
}
