"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, BTN_SUCCESS, INPUT, LABEL, SELECT } from "@/components/ui/styles";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  ApiError,
  createPlatformUser,
  fetchPlatformUsers,
  resetPlatformUserPassword,
  setPlatformUserActive,
  setPlatformUserTeam,
  type PlatformUser,
} from "@/lib/api";
import { useAdmin } from "@/lib/admin-context";

const TEAMS: Array<[string, string]> = [["SUPER_ADMIN", "مدیر ارشد"], ["SUPPORT", "پشتیبانی"], ["BILLING", "مالی"], ["ENGINEERING", "مهندسی"]];
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "خطایی رخ داد");

export default function TeamPage() {
  const { admin } = useAdmin();
  const isSuper = admin?.team === "SUPER_ADMIN";
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; email: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: "", email: "", team: "SUPPORT" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchPlatformUsers().then(setUsers).catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(() => { if (isSuper) load(); }, [isSuper, load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isSuper) {
    return <div className="p-7 text-[13px] text-muted">این بخش فقط برای مدیر ارشد در دسترس است.</div>;
  }

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[1000px] mx-auto">
      <PageHeader title="کاربران پلتفرم" subtitle="ساخت و مدیریت حساب اعضای تیم. رمزهای تولیدشده فقط یک‌بار نمایش داده می‌شوند." />

      {secret ? (
        <Card className="mt-5 p-4 border-warning bg-warning-soft">
          <div className="text-[14px] font-extrabold">{secret.title}</div>
          <p className="text-[12.5px] mt-1">این رمز فقط همین یک‌بار نمایش داده می‌شود. آن را امن به {secret.email} بدهید؛ کاربر در اولین ورود باید رمز را عوض کند.</p>
          <code dir="ltr" className="block select-all break-all bg-white rounded-xl p-3 mt-3 text-[14px]">{secret.password}</code>
          <div className="flex gap-2 mt-3">
            <button className={BTN_GHOST} onClick={() => navigator.clipboard?.writeText(secret.password)}>کپی</button>
            <button className={BTN_PRIMARY} onClick={() => setSecret(null)}>کپی کردم، بستن</button>
          </div>
        </Card>
      ) : null}

      <Card className="mt-5 p-5">
        <div className="text-[15px] font-extrabold mb-3">کاربر جدید</div>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await createPlatformUser({ name: form.name.trim(), email: form.email.trim(), team: form.team });
              setSecret({ title: "کاربر ساخته شد", email: r.email, password: r.oneTimePassword });
              setForm({ name: "", email: "", team: "SUPPORT" });
            });
          }}
        >
          <div><label className={LABEL}>نام</label><input className={INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className={LABEL}>ایمیل</label><input className={INPUT} dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className={LABEL}>تیم</label><select className={SELECT} value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>{TEAMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <button className={BTN_PRIMARY} disabled={busy || form.name.trim().length < 2 || !form.email.includes("@")}>ساخت</button>
        </form>
      </Card>

      {error ? <p className="mt-4 text-[12.5px] font-semibold rounded-xl px-3.5 py-2.5 bg-danger-soft text-danger">{error}</p> : null}

      <div className="mt-5 flex flex-col gap-3">
        {users === null ? <div className="text-[13px] text-muted">در حال بارگذاری…</div> : null}
        {users?.map((u) => {
          const self = u.id === admin?.id;
          return (
            <Card key={u.id} className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-[14px] font-extrabold">{u.name}{self ? " (شما)" : ""}</div>
                  <div dir="ltr" className="text-[12px] text-muted text-start">{u.email}</div>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    <Badge tone={u.disabled ? "danger" : "success"}>{u.disabled ? "غیرفعال" : "فعال"}</Badge>
                    <Badge tone={u.totpEnabled ? "success" : "warning"}>{u.totpEnabled ? "2FA فعال" : "بدون 2FA"}</Badge>
                    {u.mustChangePassword ? <Badge tone="warning">تغییر رمز در انتظار</Badge> : null}
                  </div>
                  <div className="text-[11.5px] text-muted mt-2">آخرین ورود: {u.lastLoginAt ? formatJalaliDateTime(u.lastLoginAt) : "—"}</div>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  <select
                    className={SELECT}
                    value={u.team}
                    disabled={busy || self}
                    onChange={(e) => run(async () => { await setPlatformUserTeam(u.id, e.target.value); })}
                  >
                    {TEAMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {!self ? (
                    <button
                      className={BTN_GHOST}
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`رمز ${u.email} بازنشانی شود؟ همه‌ی نشست‌های او بسته می‌شود.`)) return;
                        run(async () => { const r = await resetPlatformUserPassword(u.id); setSecret({ title: "رمز بازنشانی شد", email: u.email, password: r.oneTimePassword }); });
                      }}
                    >
                      بازنشانی رمز
                    </button>
                  ) : null}
                  {!self ? (
                    u.disabled
                      ? <button className={BTN_SUCCESS} disabled={busy} onClick={() => run(async () => { await setPlatformUserActive(u.id, true); })}>فعال‌سازی</button>
                      : <button className={BTN_DANGER} disabled={busy} onClick={() => { if (confirm(`حساب ${u.email} غیرفعال شود؟`)) run(async () => { await setPlatformUserActive(u.id, false); }); }}>غیرفعال‌سازی</button>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
