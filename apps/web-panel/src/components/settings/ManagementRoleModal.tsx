"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { setUserManagementRole, ApiError, type TenantUser } from "@/lib/api";

const OPTIONS = [
  { value: "MEMBER", label: "عضو عادی", hint: "فقط طبق نقش و دسترسی‌های ماژولی که دارد" },
  { value: "ADMIN", label: "مدیر", hint: "دسترسی کامل به ماژول‌ها و تأیید اسناد؛ نمی‌تواند مدیر کل یا مدیران هم‌سطح را حذف کند" },
  { value: "OWNER", label: "مدیر کل (همتراز)", hint: "دسترسی همتراز با شما؛ شما هم مدیر کل می‌مانید" },
] as const;

/** تعیین سطح مدیریتی یک کاربر یا انتقال نقش مدیر کل به او — فقط برای مدیر کل. */
export function ManagementRoleModal({ user, onClose, onDone }: { user: TenantUser; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<"OWNER" | "ADMIN" | "MEMBER">(user.membershipRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(transfer: boolean) {
    if (transfer && !confirm(`نقش مدیر کل به «${user.name}» منتقل شود و شما به «مدیر» تنزل پیدا کنید؟`)) return;
    setBusy(true);
    setError(null);
    try {
      await setUserManagementRole(user.id, { role: transfer ? "OWNER" : role, transfer });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
      setBusy(false);
    }
  }

  return (
    <Modal title={`سطح مدیریتی — ${user.name}`} onClose={onClose}>
      <div className="flex flex-col gap-2.5">
        {OPTIONS.map((o) => (
          <label key={o.value} className="flex items-start gap-2.5 border border-border rounded-xl p-3 cursor-pointer">
            <input type="radio" checked={role === o.value} onChange={() => setRole(o.value)} className="mt-1" />
            <span>
              <span className="block text-[13px] font-bold">{o.label}</span>
              <span className="block text-[11.5px] text-muted mt-0.5">{o.hint}</span>
            </span>
          </label>
        ))}
        {error && <div className="text-[12.5px] text-danger">{error}</div>}
        <button
          onClick={() => save(false)}
          disabled={busy || role === user.membershipRole}
          className="text-[13px] font-bold py-2.5 rounded-xl bg-primary text-white disabled:opacity-50 cursor-pointer"
        >
          ذخیره
        </button>
        <button
          onClick={() => save(true)}
          disabled={busy}
          className="text-[12.5px] font-bold py-2.5 rounded-xl bg-warning-soft text-warning disabled:opacity-50 cursor-pointer"
        >
          انتقال کامل نقش مدیر کل به این کاربر (من به «مدیر» تنزل می‌یابم)
        </button>
      </div>
    </Modal>
  );
}
