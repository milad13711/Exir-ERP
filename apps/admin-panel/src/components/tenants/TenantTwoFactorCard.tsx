"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDate } from "@/lib/persian";
import { ApiError, fetchTenantTwoFactor, resetTenantUserTwoFactor, setTenantTwoFactorPolicy, type TenantTwoFactorOverview } from "@/lib/api";
import { useAdmin } from "@/lib/admin-context";

const MODE_LABELS = { off: "خاموش", grace: "مهلت‌دار", enforce: "اجباری فوری" } as const;

/**
 * ورود دومرحله‌ای مالک/مدیر یک تننت (فقط SUPER_ADMIN): وضعیت هر کاربر، تغییر سیاست تننت و بازنشانی 2FA برای
 * کاربری که هم احراز‌گر و هم کدهای بازیابی را گم کرده. قبل از بازنشانی هویت فرد را از مسیر مستقل تأیید کنید.
 */
export function TenantTwoFactorCard({ tenantId }: { tenantId: string }) {
  const { admin } = useAdmin();
  const [data, setData] = useState<TenantTwoFactorOverview | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function reload() {
    fetchTenantTwoFactor(tenantId).then(setData).catch(() => setData(null));
  }
  useEffect(reload, [tenantId]);

  if (admin?.team !== "SUPER_ADMIN") return null;

  async function run(fn: () => Promise<void>) {
    setMsg(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "خطایی رخ داد");
    }
  }

  return (
    <Card className="mt-5 p-5">
      <div className="text-[13.5px] font-bold mb-1">ورود دومرحله‌ای مالک و مدیران</div>
      {data ? (
        <>
          <div className="flex items-center gap-2 flex-wrap text-[12.5px] mb-3">
            <span className="text-muted">سیاست مؤثر: {MODE_LABELS[data.effectiveMode]}{data.policy === null ? " (پیش‌فرض سرور)" : " (تنظیم همین تننت)"}</span>
            <select
              className="text-[12.5px] bg-slate-50 border border-border rounded-lg px-2.5 py-1.5"
              value={data.policy ?? ""}
              onChange={(e) => run(async () => { await setTenantTwoFactorPolicy(tenantId, (e.target.value || null) as "off" | "grace" | "enforce" | null); })}
            >
              <option value="">پیش‌فرض سرور</option>
              <option value="off">خاموش</option>
              <option value="grace">مهلت‌دار</option>
              <option value="enforce">اجباری فوری</option>
            </select>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {data.users.map((u) => (
              <div key={u.membershipId} className="py-2.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px] text-[13px]">
                  {u.name ?? "بدون نام"} <span dir="ltr" className="text-muted text-[12px]">{u.phone}</span> <span className="text-muted text-[11.5px]">({u.role})</span>
                </div>
                {u.enrolled ? <Badge tone="success">فعال</Badge> : u.restricted ? <Badge tone="danger">قفل تا ثبت 2FA</Badge> : <Badge tone="warning">{u.graceEndsAt ? `مهلت تا ${formatJalaliDate(u.graceEndsAt)}` : "ثبت نشده"}</Badge>}
                <button
                  type="button"
                  className="text-[12px] font-bold px-3 py-1.5 rounded-lg bg-danger-soft text-danger cursor-pointer"
                  onClick={() => {
                    const reason = window.prompt("دلیل بازنشانی و نحوه‌ی تأیید هویت (مثلاً شماره‌ی تیکت و تماس با شماره‌ی ثبت‌شده):");
                    if (!reason || reason.trim().length < 5) return;
                    if (!window.confirm("2FA این کاربر پاک و همه‌ی نشست‌های او باطل می‌شود و باید دوباره ثبت کند. ادامه می‌دهید؟")) return;
                    run(async () => { const r = await resetTenantUserTwoFactor(tenantId, u.userId, reason.trim()); setMsg(`انجام شد؛ ${r.sessionsRevoked} نشست باطل شد.`); });
                  }}
                >
                  بازنشانی 2FA
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-[12.5px] text-muted">در حال بارگذاری...</div>
      )}
      {msg ? <div className="mt-3 text-[12.5px]">{msg}</div> : null}
    </Card>
  );
}
