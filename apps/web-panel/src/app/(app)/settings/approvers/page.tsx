"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  PERMISSION_GATED_MODULE_CODES,
  fetchModules,
  fetchModuleApprovers,
  fetchUsers,
  setModuleApprover,
  ApiError,
  type ModuleCatalogItem,
  type TenantUser,
} from "@/lib/api";

/** مدیر تأییدکننده‌ی نهایی هر ماژول — اسناد آن ماژول برای او و مدیران بالادستی در کارتابل نمایش داده می‌شود. */
export default function ModuleApproversPage() {
  const [catalog, setCatalog] = useState<ModuleCatalogItem[] | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [approvers, setApprovers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  useEffect(() => {
    fetchModules().then(setCatalog).catch(() => setCatalog([]));
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    fetchModuleApprovers()
      .then((rows) => setApprovers(Object.fromEntries(rows.map((r) => [r.moduleCode, r.userId]))))
      .catch(() => undefined);
  }, []);

  const rows = useMemo(() => {
    const byCode = new Map((catalog ?? []).map((m) => [m.code, m]));
    const modules = PERMISSION_GATED_MODULE_CODES.filter((code) => {
      const m = byCode.get(code);
      return m && (m.installStatus === "INSTALLED" || m.installStatus === "TRIAL" || (m.installStatus === null && m.isCore));
    }).map((code) => ({ code, label: byCode.get(code)?.name ?? code }));
    // کاربران (حذف کاربر) ماژول نیست ولی تأیید مدیر می‌خواهد
    return [...modules, { code: "users", label: "کاربران (حذف کاربر)" }];
  }, [catalog]);

  async function change(code: string, userId: string) {
    setSavingCode(code);
    setError(null);
    try {
      await setModuleApprover(code, userId || null);
      setApprovers((prev) => {
        const next = { ...prev };
        if (userId) next[code] = userId;
        else delete next[code];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold mb-1">مدیر تأییدکننده‌ی ماژول‌ها</h1>
      <p className="text-[13px] text-muted mb-5 max-w-[560px]">
        برای هر ماژول، مدیری را تعیین کنید که تأیید نهایی اسناد آن بخش با اوست. این اسناد در کارتابل او و مدیران بالادستی (مدیر کل و مدیران) نمایش داده می‌شود. اگر انتخاب نشود، فقط مدیران می‌بینند.
      </p>
      {error && <div className="text-[12.5px] text-danger mb-3">{error}</div>}
      <Card className="p-2">
        {rows.map((r, i) => (
          <div key={r.code} className={`flex items-center gap-3 px-4 py-3 ${i < rows.length - 1 ? "border-b border-border" : ""}`}>
            <div className="flex-1 text-[13.5px] font-bold">{r.label}</div>
            <select
              value={approvers[r.code] ?? ""}
              disabled={savingCode === r.code}
              onChange={(e) => change(r.code, e.target.value)}
              className="w-[220px] max-w-[50%] text-[12.5px] outline-none bg-surface border border-border rounded-lg px-3 py-2 focus:border-primary"
            >
              <option value="">فقط مدیران (پیش‌فرض)</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </Card>
    </div>
  );
}
