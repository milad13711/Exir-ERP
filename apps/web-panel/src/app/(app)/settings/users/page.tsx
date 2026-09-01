"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getInitials, toPersianDigits } from "@/lib/persian";
import {
  fetchUsers,
  fetchRoles,
  fetchRolesWithPermissions,
  inviteUser,
  ApiError,
  type TenantUser,
  type TenantRoleOption,
  type TenantRoleWithPermissions,
} from "@/lib/api";
import { RolePermissionsModal } from "@/components/settings/RolePermissionsModal";
import { ShieldIcon } from "@/components/icons";

const roleTones: Record<string, "primary" | "accent" | "warning" | "neutral"> = {
  "مدیر سیستم": "primary",
  "کارشناس فروش": "accent",
  حسابدار: "warning",
};

export default function UsersRolesPage() {
  const [users, setUsers] = useState<TenantUser[] | null>(null);
  const [roles, setRoles] = useState<TenantRoleOption[]>([]);
  const [rolesWithPerms, setRolesWithPerms] = useState<TenantRoleWithPermissions[]>([]);
  const [editingRole, setEditingRole] = useState<TenantRoleWithPermissions | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function reload() {
    fetchUsers().then(setUsers).catch(() => setUsers([]));
    fetchRoles().then((r) => {
      setRoles(r);
      setRoleId((current) => current || r[0]?.id || "");
    });
    fetchRolesWithPermissions().then(setRolesWithPerms).catch(() => setRolesWithPerms([]));
  }

  useEffect(reload, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await inviteUser(name.trim(), phone.trim(), roleId);
      setName("");
      setPhone("");
      setShowInvite(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "افزودن کاربر با خطا مواجه شد");
    } finally {
      setSubmitting(false);
    }
  }

  const activeCount = users?.filter((u) => u.status === "ACTIVE").length ?? 0;
  const pendingCount = users?.filter((u) => u.status === "INVITED").length ?? 0;

  const stats = [
    { label: "کل کاربران", value: `${toPersianDigits(users?.length ?? 0)} نفر` },
    { label: "نقش‌های تعریف‌شده", value: `${toPersianDigits(roles.length)} نقش` },
    { label: "دعوت‌های در انتظار", value: `${toPersianDigits(pendingCount)} نفر` },
    { label: "کاربران فعال", value: `${toPersianDigits(activeCount)} نفر` },
  ];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5.5 gap-4">
        <div>
          <h1 className="text-xl font-extrabold">کاربران و نقش‌ها</h1>
          <p className="text-[13.5px] text-muted mt-1">
            دسترسی هر کاربر به ماژول‌ها و بخش‌های مختلف را مدیریت کنید
          </p>
        </div>
        <button
          onClick={() => setShowInvite((v) => !v)}
          className="border-0 bg-primary text-white px-4.5 py-2.75 rounded-[11px] text-[13px] font-bold whitespace-nowrap"
        >
          + افزودن کاربر
        </button>
      </div>

      {showInvite ? (
        <Card className="p-5 mb-5.5">
          <form onSubmit={handleInvite} className="grid sm:grid-cols-4 gap-3 items-end">
            <div className="sm:col-span-1">
              <label className="block text-[12.5px] font-semibold mb-1.5">نام</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-[10px] border border-border text-[13px] outline-none focus:border-primary"
                placeholder="نام و نام خانوادگی"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-[12.5px] font-semibold mb-1.5">شماره موبایل</label>
              <input
                required
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2.5 rounded-[10px] border border-border text-[13px] outline-none focus:border-primary text-center"
                placeholder="09121234567"
              />
            </div>
            <div className="sm:col-span-1">
              <label className="block text-[12.5px] font-semibold mb-1.5">نقش</label>
              <select
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-[10px] border border-border text-[13px] outline-none focus:border-primary bg-white"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="sm:col-span-1 py-2.75 rounded-[10px] bg-primary text-white text-[13px] font-bold disabled:opacity-50"
            >
              {submitting ? "در حال ارسال..." : "ارسال دعوت‌نامه"}
            </button>
          </form>
          {error ? <div className="text-[12.5px] text-danger font-semibold mt-3">{error}</div> : null}
        </Card>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5.5">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs text-muted">{s.label}</div>
            <div className="text-lg font-extrabold mt-2">{s.value}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-3.5 pb-3">نام و شماره</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-3.5 pb-3">نقش</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-3.5 pb-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {users === null ? (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-muted text-sm">
                    در حال بارگذاری...
                  </td>
                </tr>
              ) : (
                users.map((u, i) => (
                  <tr key={u.id} className={i < users.length - 1 ? "border-b border-border" : ""}>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8.5 h-8.5 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0"
                          style={{
                            background:
                              u.status === "INVITED"
                                ? "#e2e8f0"
                                : "linear-gradient(135deg, var(--color-primary), var(--color-accent))",
                          }}
                        >
                          <span className={u.status === "INVITED" ? "text-muted" : ""}>
                            {getInitials(u.name)}
                          </span>
                        </div>
                        <div>
                          <div className={u.status === "INVITED" ? "font-bold text-muted" : "font-bold"}>
                            {u.name}
                          </div>
                          <div className="text-[11.5px] text-muted" dir="ltr">
                            {u.phone}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5">
                      {u.roles.map((r) => (
                        <Badge key={r} tone={roleTones[r] ?? "neutral"} className="me-1.5">
                          {r}
                        </Badge>
                      ))}
                    </td>
                    <td className="p-3.5">
                      {u.status === "ACTIVE" ? (
                        <Badge tone="success">فعال</Badge>
                      ) : (
                        <Badge tone="neutral">دعوت در انتظار</Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5.5">
        <h2 className="text-[15px] font-extrabold mb-1">نقش‌ها و سطح دسترسی</h2>
        <p className="text-[12.5px] text-muted mb-3.5">
          برای هر نقش تعیین کنید در هر بخش چه کاری مجاز است — مشاهده همه یا فقط رکوردهای خودشان، ایجاد، ویرایش، حذف
        </p>
        <Card className="p-2">
          {rolesWithPerms.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center justify-between px-4 py-3 ${
                i < rolesWithPerms.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold">{r.name}</span>
                {r.isSystem ? <Badge tone="neutral">پیش‌فرض</Badge> : null}
              </div>
              <button
                onClick={() => setEditingRole(r)}
                className="flex items-center gap-1.5 text-[12px] font-bold text-primary bg-primary-soft px-3.5 py-1.5 rounded-lg cursor-pointer"
              >
                <ShieldIcon className="w-3.5 h-3.5" />
                تنظیم دسترسی
              </button>
            </div>
          ))}
        </Card>
      </div>

      {editingRole ? (
        <RolePermissionsModal role={editingRole} onClose={() => setEditingRole(null)} onSaved={reload} />
      ) : null}
    </div>
  );
}
