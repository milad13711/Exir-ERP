import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { BTN_DANGER, BTN_GHOST, BTN_PRIMARY, INPUT, LABEL } from "@/components/ui/styles";
import { issueOfflineToken, renewLicense, type LicenseRow } from "@/lib/licenses-api";
import { copyText, errMsg } from "./shared";

/** تأیید با «دلیل» اجباری (تعلیق / لغو / حذف) — دلیل در ردپای عملیات ثبت می‌شود. */
export function ReasonDialog({ title, description, confirmLabel, onConfirm, onClose }: {
  title: string; description: string; confirmLabel: string; onConfirm: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true); setError(null);
        try { await onConfirm(reason.trim()); onClose(); } catch (err) { setError(errMsg(err, "عملیات ناموفق بود")); } finally { setBusy(false); }
      }}>
        <p className="text-[13px] text-ink-soft leading-6">{description}</p>
        <div>
          <label className={LABEL}>دلیل (الزامی)</label>
          <textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} minLength={3} required />
        </div>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button type="submit" disabled={busy || reason.trim().length < 3} className={`${BTN_DANGER} w-full py-2.5`}>{busy ? "..." : confirmLabel}</button>
      </form>
    </Modal>
  );
}

export function RenewDialog({ license, onClose, onDone }: { license: LicenseRow; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"extend" | "date" | "perpetual">("extend");
  const [days, setDays] = useState(365);
  const [date, setDate] = useState("");
  const [updMode, setUpdMode] = useState<"keep" | "date" | "unlimited">("keep");
  const [updDate, setUpdDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await renewLicense(license.id, {
        ...(mode === "extend" ? { extendDays: days } : mode === "date" ? { expiresAt: date } : { perpetual: true }),
        ...(updMode === "date" ? { updatesUntil: updDate } : updMode === "unlimited" ? { updatesUnlimited: true } : {}),
      });
      onDone(); onClose();
    } catch (err) { setError(errMsg(err, "تمدید ناموفق بود")); } finally { setBusy(false); }
  }
  const radio = "flex items-center gap-2 text-[13px] cursor-pointer";
  return (
    <Modal title={`تمدید لایسنس — ${license.orgName}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>انقضای لایسنس</legend>
          <label className={radio}><input type="radio" checked={mode === "extend"} onChange={() => setMode("extend")} /> افزودن
            <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${INPUT} !w-24`} /> روز
          </label>
          <label className={radio}><input type="radio" checked={mode === "date"} onChange={() => setMode("date")} /> تاریخ مشخص</label>
          {mode === "date" ? <JalaliDateInput value={date} onChange={setDate} /> : null}
          <label className={radio}><input type="radio" checked={mode === "perpetual"} onChange={() => setMode("perpetual")} /> دائمی (بدون انقضا)</label>
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>حق به‌روزرسانی / پشتیبانی</legend>
          <label className={radio}><input type="radio" checked={updMode === "keep"} onChange={() => setUpdMode("keep")} /> بدون تغییر</label>
          <label className={radio}><input type="radio" checked={updMode === "date"} onChange={() => setUpdMode("date")} /> تا تاریخ</label>
          {updMode === "date" ? <JalaliDateInput value={updDate} onChange={setUpdDate} /> : null}
          <label className={radio}><input type="radio" checked={updMode === "unlimited"} onChange={() => setUpdMode("unlimited")} /> نامحدود</label>
        </fieldset>
        {error ? <div className="text-[12px] text-danger">{error}</div> : null}
        <button type="submit" disabled={busy || (mode === "date" && !date) || (updMode === "date" && !updDate)} className={`${BTN_PRIMARY} w-full`}>{busy ? "..." : "اعمال تمدید"}</button>
      </form>
    </Modal>
  );
}

export function OfflineTokenDialog({ license, onClose, onDone }: { license: LicenseRow; onClose: () => void; onDone: () => void }) {
  const [installationId, setInstallationId] = useState("");
  const [days, setDays] = useState(365);
  const [reason, setReason] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="صدور توکن آفلاین (سرور بدون اینترنت)" onClose={onClose} width="max-w-[560px]">
      {token ? (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-ink-soft leading-6">این توکن فقط برای همین شناسه‌ی نصب معتبر است و یک‌بار نمایش داده می‌شود (ذخیره نمی‌شود). مشتری آن را در <span dir="ltr" className="font-mono">LICENSE_TOKEN</span> فایل <span dir="ltr" className="font-mono">.env</span> می‌گذارد.</p>
          <textarea readOnly dir="ltr" rows={6} value={token} className={`${INPUT} font-mono text-[11px] text-left`} />
          <button className={BTN_GHOST} onClick={() => copyText(token)}>کپی توکن</button>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true); setError(null);
          try { const r = await issueOfflineToken(license.id, { installationId: installationId.trim(), validityDays: days, reason }); setToken(r.token); onDone(); }
          catch (err) { setError(errMsg(err, "صدور ناموفق بود")); } finally { setBusy(false); }
        }}>
          <p className="text-[12.5px] text-muted leading-6">مشتری شناسه‌ی نصب (installationId) را از صفحه‌ی «وضعیت لایسنس» سامانه‌اش می‌دهد. این عملیات یک ظرفیت فعال‌سازی مصرف می‌کند و در ردپا ثبت می‌شود.</p>
          <div><label className={LABEL}>شناسه‌ی نصب</label><input dir="ltr" value={installationId} onChange={(e) => setInstallationId(e.target.value)} className={`${INPUT} font-mono text-left`} required minLength={8} /></div>
          <div><label className={LABEL}>اعتبار توکن (روز) — پیش از آن باید دوباره صادر شود</label><input type="number" min={1} max={1100} value={days} onChange={(e) => setDays(Number(e.target.value))} className={INPUT} /></div>
          <div><label className={LABEL}>دلیل</label><input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} required minLength={3} /></div>
          {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          <button type="submit" disabled={busy || installationId.trim().length < 8 || reason.trim().length < 3} className={`${BTN_PRIMARY} w-full`}>{busy ? "..." : "صدور توکن"}</button>
        </form>
      )}
    </Modal>
  );
}

/** راهنمای نصب برای مشتری با کلید همین لایسنس (کلید راز نیست؛ اعتبارش با فعال‌سازی و سقف نصب محدود می‌شود). */
export function InstallGuideDialog({ license, onClose }: { license: LicenseRow; onClose: () => void }) {
  const env = `# .env (کنار docker-compose.yml)
LICENSE_KEY=${license.licenseKey ?? ""}
LICENSE_SERVER_URL=https://<آدرس-سرور-لایسنس-اکسیر>
LICENSE_PUBLIC_KEY_PEM="<کلید عمومی که اکسیر همراه بسته داده — با \\n>"
ON_PREM_ORG_NAME=${license.orgName}
ON_PREM_OWNER_NAME=<نام مدیر>
ON_PREM_OWNER_PHONE=<موبایل مدیر>
POSTGRES_PASSWORD=<رمز قوی>
JWT_SECRET=<openssl rand -hex 32>`;
  const compose = `# docker-compose.yml (فقط ایمیج‌ها — بدون سورس)
services:
  backend:
    image: registry.example.ir/exir/backend:<نسخه>
    env_file: .env
    environment: { DEPLOYMENT_MODE: ON_PREMISE, LICENSE_STATE_DIR: /app/data/license }
    volumes:
      - exir_license_state:/app/data          # اجباری: شناسه‌ی نصب و توکن
      - /etc/machine-id:/etc/host-machine-id:ro
volumes:
  exir_license_state:`;
  return (
    <Modal title="راهنمای نصب برای مشتری" onClose={onClose} width="max-w-[680px]">
      <div className="flex flex-col gap-3.5 text-[12.5px] text-ink-soft leading-6">
        <p>۱) فایل‌های بالا را برای مشتری بفرستید. ۲) مشتری <span dir="ltr" className="font-mono">docker compose up -d</span> می‌زند؛ سامانه خودکار فعال می‌شود و نصب به این لایسنس گره می‌خورد ({license.maxActivations === 0 ? "نصب نامحدود" : `حداکثر ${license.maxActivations} نصب`}). ۳) اگر سرور اینترنت ندارد از «توکن آفلاین» استفاده کنید.</p>
        <div>
          <div className="flex items-center justify-between mb-1"><span className={LABEL}>.env</span><button className={BTN_GHOST} onClick={() => copyText(env)}>کپی</button></div>
          <pre dir="ltr" className="bg-slate-50 border border-border rounded-xl p-3 text-[11px] overflow-x-auto text-left whitespace-pre-wrap break-all">{env}</pre>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1"><span className={LABEL}>docker compose</span><button className={BTN_GHOST} onClick={() => copyText(compose)}>کپی</button></div>
          <pre dir="ltr" className="bg-slate-50 border border-border rounded-xl p-3 text-[11px] overflow-x-auto text-left">{compose}</pre>
        </div>
        <p className="text-muted">راهنمای کامل برای مشتری: <span dir="ltr" className="font-mono">docs/licensing/customer-guide-fa.md</span></p>
      </div>
    </Modal>
  );
}
