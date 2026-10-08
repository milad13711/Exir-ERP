"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, INPUT, LABEL } from "@/components/ui/styles";
import { formatJalaliDateTime } from "@/lib/persian";
import {
  ApiError,
  beginTwoFaSetup,
  changePassword,
  disableTwoFa,
  enableTwoFa,
  fetchMe,
  fetchTwoFaStatus,
  setToken,
  updateProfile,
  type AdminMe,
} from "@/lib/api";
import { persistAdmin, useAdmin } from "@/lib/admin-context";

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "خطایی رخ داد");

/** سنجش ساده‌ی قدرت رمز (فقط راهنما؛ سیاست اصلی در سرور اعمال می‌شود). */
function passwordChecks(pw: string, email?: string) {
  const local = email?.split("@")[0]?.toLowerCase();
  return [
    { ok: pw.length >= 12, label: "حداقل ۱۲ نویسه" },
    { ok: /[A-Za-z]/.test(pw) && /\d/.test(pw), label: "هم حرف و هم عدد" },
    { ok: !!pw && !(local && local.length >= 3 && pw.toLowerCase().includes(local)) && !/exiradmin|exirsupport|password/i.test(pw), label: "بدون رمز پیش‌فرض و بدون بخش ایمیل" },
  ];
}

function StrengthMeter({ pw, email }: { pw: string; email?: string }) {
  const checks = passwordChecks(pw, email);
  let score = checks.filter((c) => c.ok).length;
  if (pw.length >= 16 && /[^A-Za-z0-9]/.test(pw) && score === 3) score = 4;
  const tone = ["bg-danger", "bg-danger", "bg-warning", "bg-primary", "bg-success"][score];
  return (
    <div className="mt-2">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${pw && i <= score ? tone : "bg-slate-200"}`} />
        ))}
      </div>
      <ul className="mt-2 space-y-1">
        {checks.map((c) => (
          <li key={c.label} className={`text-[11.5px] ${c.ok ? "text-success" : "text-muted"}`}>
            {c.ok ? "✓" : "○"} {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notice({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  return <p className={`text-[12.5px] font-semibold rounded-xl px-3.5 py-2.5 ${kind === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{children}</p>;
}

export default function AccountPage() {
  const router = useRouter();
  const { admin, mustChangePassword } = useAdmin();
  const [me, setMe] = useState<AdminMe | null>(null);

  const reload = useCallback(() => {
    fetchMe().then(setMe).catch(() => setMe(null));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div className="p-4 sm:p-5 lg:p-7 max-w-[760px] mx-auto">
      <PageHeader title="حساب من" subtitle={me ? `${me.email} — ${me.team}${me.lastLoginAt ? ` — آخرین ورود: ${formatJalaliDateTime(me.lastLoginAt)}` : ""}` : undefined} />
      {mustChangePassword ? (
        <Card className="mt-5 p-4 border-warning bg-warning-soft">
          <div className="text-[14px] font-extrabold text-warning">تغییر رمز عبور الزامی است</div>
          <p className="text-[12.5px] mt-1">حساب شما با رمز پیش‌فرض یا یک‌بارمصرف وارد شده است. تا رمز جدید و امن تعیین نکنید، سایر بخش‌های پنل در دسترس نیست.</p>
        </Card>
      ) : null}
      <PasswordCard
        email={me?.email}
        forced={mustChangePassword}
        onDone={() => {
          reload();
          if (mustChangePassword) router.replace("/tenants");
        }}
      />
      {!mustChangePassword && me ? (
        <>
          <ProfileCard me={me} onSaved={(m) => { setMe(m); if (admin) persistAdmin({ ...admin, name: m.name }); }} />
          <TwoFaCard onChanged={reload} />
        </>
      ) : null}
    </div>
  );
}

function PasswordCard({ email, forced, onDone }: { email?: string; forced: boolean; onDone: () => void }) {
  const { admin } = useAdmin();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const valid = useMemo(() => passwordChecks(next, email).every((c) => c.ok) && next === confirm && !!current && next !== current, [next, confirm, current, email]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await changePassword(current, next);
      setToken(res.accessToken); // سایر نشست‌ها باطل شدند؛ این توکن تازه است
      if (admin) persistAdmin(admin, false);
      setCurrent("");
      setNext("");
      setConfirm("");
      setMsg({ kind: "ok", text: "رمز عبور تغییر کرد. سایر نشست‌های شما بسته شدند." });
      onDone();
    } catch (err) {
      setMsg({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5 p-5">
      <div className="text-[15px] font-extrabold mb-3">تغییر رمز عبور</div>
      <form onSubmit={submit} className="flex flex-col gap-3.5 max-w-[420px]">
        <div>
          <label className={LABEL}>{forced ? "رمز فعلی (پیش‌فرض/یک‌بارمصرف)" : "رمز عبور فعلی"}</label>
          <input className={INPUT} dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>رمز عبور جدید</label>
          <input className={INPUT} dir="ltr" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <StrengthMeter pw={next} email={email} />
        </div>
        <div>
          <label className={LABEL}>تکرار رمز جدید</label>
          <input className={INPUT} dir="ltr" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {confirm && next !== confirm ? <p className="text-[11.5px] text-danger mt-1">با رمز جدید یکسان نیست</p> : null}
        </div>
        {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
        <button className={BTN_PRIMARY} disabled={!valid || busy}>{busy ? "در حال ذخیره…" : "تغییر رمز عبور"}</button>
      </form>
    </Card>
  );
}

function ProfileCard({ me, onSaved }: { me: AdminMe; onSaved: (m: AdminMe) => void }) {
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const emailChanged = email.trim().toLowerCase() !== me.email.toLowerCase();
  const dirty = emailChanged || name.trim() !== me.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const m = await updateProfile({ name: name.trim(), ...(emailChanged ? { email: email.trim(), currentPassword: password } : {}) });
      onSaved(m);
      setPassword("");
      setMsg({ kind: "ok", text: "پروفایل ذخیره شد." });
    } catch (err) {
      setMsg({ kind: "err", text: errMsg(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5 p-5">
      <div className="text-[15px] font-extrabold mb-3">پروفایل</div>
      <form onSubmit={submit} className="flex flex-col gap-3.5 max-w-[420px]">
        <div>
          <label className={LABEL}>نام</label>
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={LABEL}>ایمیل (نام کاربری ورود)</label>
          <input className={INPUT} dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {emailChanged ? (
          <div>
            <label className={LABEL}>برای تغییر ایمیل، رمز عبور فعلی را وارد کنید</label>
            <input className={INPUT} dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        ) : null}
        {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
        <button className={BTN_PRIMARY} disabled={!dirty || busy || (emailChanged && !password)}>ذخیره</button>
      </form>
    </Card>
  );
}

function TwoFaCard({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; recoveryCodesLeft: number; required: boolean } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string; qrSvg?: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTwoFaStatus().then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadCodes() {
    if (!recovery) return;
    const blob = new Blob([`کدهای بازیابی اکسیر (هر کد یک‌بار مصرف)\n\n${recovery.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "exir-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Card className="mt-5 p-5">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-[15px] font-extrabold">احراز هویت دو مرحله‌ای</div>
        {status ? <Badge tone={status.enabled ? "success" : "warning"}>{status.enabled ? "فعال" : "غیرفعال"}</Badge> : null}
      </div>
      <p className="text-[12.5px] text-muted mb-4">با Google Authenticator، Authy یا 1Password. {status?.required ? "برای این پلتفرم اجباری است." : "برای حساب مدیریتی شدیداً توصیه می‌شود."}</p>

      {recovery ? (
        <div className="flex flex-col gap-3 max-w-[420px]">
          <Notice kind="ok">تأیید دومرحله‌ای فعال شد. این کدهای بازیابی را همین حالا ذخیره کنید؛ دیگر نمایش داده نمی‌شوند.</Notice>
          <div dir="ltr" className="grid grid-cols-2 gap-2 bg-slate-100 rounded-xl p-3 text-[13px] font-mono select-all">
            {recovery.map((c) => <span key={c}>{c}</span>)}
          </div>
          <div className="flex gap-2">
            <button type="button" className={BTN_GHOST} onClick={() => navigator.clipboard?.writeText(recovery.join("\n"))}>کپی</button>
            <button type="button" className={BTN_GHOST} onClick={downloadCodes}>دانلود</button>
            <button type="button" className={BTN_PRIMARY} onClick={() => { setRecovery(null); load(); onChanged(); }}>ذخیره کردم</button>
          </div>
        </div>
      ) : status?.enabled ? (
        <div className="flex flex-col gap-3 max-w-[380px]">
          <p className="text-[12.5px]">{status.recoveryCodesLeft} کد بازیابی باقی مانده است. برای غیرفعال‌سازی رمز عبور و یک کد لازم است.</p>
          <input className={INPUT} dir="ltr" type="password" placeholder="رمز عبور" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className={INPUT} dir="ltr" placeholder="کد ۶ رقمی یا کد بازیابی" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className={BTN_DANGER} disabled={busy || !password || code.length < 6} onClick={() => run(async () => { await disableTwoFa(password, code); setPassword(""); setCode(""); load(); onChanged(); })}>
            غیرفعال‌سازی
          </button>
        </div>
      ) : setup ? (
        <div className="flex flex-col gap-3 max-w-[420px]">
          <p className="text-[12.5px]">QR را با برنامه‌ی احراز هویت اسکن کنید (یا کلید را دستی وارد کنید) و کد ۶ رقمی را بزنید:</p>
          {setup.qrSvg ? <div className="w-48 h-48 bg-white p-2 rounded-xl border border-border self-center [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} /> : null}
          <code dir="ltr" className="select-all break-all bg-slate-100 rounded-xl p-3 text-[13px]">{setup.secret}</code>
          <input className={INPUT} dir="ltr" inputMode="numeric" placeholder="کد ۶ رقمی" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className={BTN_PRIMARY} disabled={busy || code.length !== 6} onClick={() => run(async () => { const r = await enableTwoFa(code); setRecovery(r.recoveryCodes); setSetup(null); setCode(""); })}>
            تأیید و فعال‌سازی
          </button>
        </div>
      ) : (
        <button className={BTN_PRIMARY} disabled={busy} onClick={() => run(async () => setSetup(await beginTwoFaSetup()))}>شروع راه‌اندازی</button>
      )}
      {msg ? <div className="mt-3"><Notice kind="err">{msg}</Notice></div> : null}
    </Card>
  );
}
