"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchRoles, grantEmployeeAccess, ApiError, type Employee, type TenantRoleOption } from "@/lib/api";

/** ایجاد کاربر (دسترسی ورود) برای یک پرسنل موجود، مستقیم از لیست منابع انسانی. */
export function GrantAccessModal({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const [roles, setRoles] = useState<TenantRoleOption[]>([]);
  const [roleId, setRoleId] = useState("");
  const [phone, setPhone] = useState(employee.phone ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRoles().then(setRoles).catch(() => setRoles([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!roleId) return setError("سطح دسترسی (نقش) را انتخاب کنید");
    setBusy(true);
    setError(null);
    try {
      await grantEmployeeAccess(employee.id, { roleId, phone: phone.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ایجاد کاربر ناموفق بود");
      setBusy(false);
    }
  }

  return (
    <Modal title={`ایجاد دسترسی کاربری — ${employee.fullName}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">شماره‌ی موبایل (ورود با پیامک)</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            dir="ltr"
            inputMode="tel"
            className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-ink-soft">نقش (سطح دسترسی)</span>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-full text-[13px] outline-none bg-surface border border-border rounded-xl px-3.5 py-2.5 focus:border-primary">
            <option value="">انتخاب کنید...</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <div className="text-[11.5px] text-muted">پس از ایجاد، پیامک فعال‌سازی و نحوه‌ی ورود برای پرسنل ارسال می‌شود.</div>
        {error && <div className="text-[12.5px] text-danger">{error}</div>}
        <button disabled={busy} className="text-[13px] font-bold py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer">
          ایجاد کاربر
        </button>
      </form>
    </Modal>
  );
}
