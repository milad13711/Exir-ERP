import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { updateUser, changeUserPhone, ApiError, type TenantUser, type TenantRoleOption } from "@/lib/api";

/** ارقام فارسی/عربی → لاتین و حذف فاصله/خط تیره (کاربر شماره را هر طور تایپ کند). */
function normalizePhone(v: string): string {
  return v
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[\s-]/g, "")
    .replace(/^\+98/, "0")
    .replace(/^0098/, "0");
}

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const STATUS_LABELS: Record<TenantUser["status"], string> = {
  INVITED: "دعوت در انتظار",
  ACTIVE: "فعال",
  DISABLED: "غیرفعال",
};

export function EditUserModal({
  user,
  roles,
  onClose,
  onSaved,
}: {
  user: TenantUser;
  roles: TenantRoleOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone);
  const [email, setEmail] = useState(user.email ?? "");
  const [status, setStatus] = useState<TenantUser["status"]>(user.status);
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set(user.roleIds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(id: string) {
    setRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const nextPhone = normalizePhone(phone);
    const phoneChanged = nextPhone !== user.phone;
    if (phoneChanged && !/^09\d{9}$/.test(nextPhone)) {
      setError("شماره موبایل نامعتبر است (مثال: 09121234567)");
      return;
    }
    if (
      phoneChanged &&
      !window.confirm(`شماره‌ی ورود «${user.name}» از ${user.phone} به ${nextPhone} تغییر کند؟\nاز این پس فقط با شماره‌ی جدید وارد می‌شود و نشست‌های فعلی‌اش بسته می‌شود.`)
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateUser(user.id, {
        name: name.trim(),
        email: email.trim() || null,
        status,
        roleIds: [...roleIds],
      });
      // آخرین گام: تغییر شماره نشست‌های همان کاربر را می‌بندد (اگر خودِ شما باشید، باید دوباره وارد شوید)
      if (phoneChanged) await changeUserPhone(user.id, nextPhone);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="ویرایش کاربر" onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>نام و نام خانوادگی</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoFocus />
        </div>
        <div>
          <label className={labelClass}>شماره موبایل</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            dir="ltr"
            placeholder="09121234567"
            className={inputClass}
          />
          <p className="mt-1 text-[11px] text-muted leading-5">
            با تغییر شماره، کاربر از این پس با شماره‌ی جدید وارد می‌شود (همان حساب و همان سوابق). اگر این شخص در کسب‌وکار دیگری
            هم عضو باشد، تغییر شماره فقط از طریق پشتیبانی ممکن است.
          </p>
        </div>
        <div>
          <label className={labelClass}>ایمیل</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>وضعیت</label>
          <div className="flex gap-2">
            {(Object.keys(STATUS_LABELS) as TenantUser["status"][]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex-1 text-[11.5px] font-bold py-2 rounded-lg border cursor-pointer ${status === s ? "bg-primary text-white border-primary" : "border-border text-ink-soft bg-white"}`}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={labelClass}>نقش‌ها</label>
          <div className="flex flex-col gap-1.5 max-h-[180px] overflow-y-auto border border-border rounded-xl p-2.5">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-[13px] font-semibold cursor-pointer px-1.5 py-1">
                <input type="checkbox" checked={roleIds.has(r.id)} onChange={() => toggleRole(r.id)} />
                {r.name}
              </label>
            ))}
          </div>
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="mt-1.5 w-full py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
        </button>
      </form>
    </Modal>
  );
}
