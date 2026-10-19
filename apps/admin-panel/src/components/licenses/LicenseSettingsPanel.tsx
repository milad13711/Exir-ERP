import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { BTN_GHOST, BTN_PRIMARY, INPUT, LABEL } from "@/components/ui/styles";
import { fetchLicenseSettings, updateLicenseSettings, type LicenseSettings } from "@/lib/licenses-api";
import { copyText, errMsg } from "./shared";

/** تنظیمات سیستم لایسنس. کلید خصوصی هرگز نمایش داده نمی‌شود؛ فقط kid و کلید عمومی. */
export function LicenseSettingsPanel() {
  const [s, setS] = useState<LicenseSettings | null>(null);
  const [days, setDays] = useState(14);
  const [sample, setSample] = useState(20);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { fetchLicenseSettings().then((r) => { setS(r); setDays(r.tokenValidityDays); setSample(r.auditSampleEvery); }).catch((e) => setMsg(errMsg(e, "بارگذاری ناموفق"))); }, []);
  if (!s) return <div className="mt-5 text-[13px] text-muted">{msg ?? "در حال بارگذاری..."}</div>;

  async function save(patch: Parameters<typeof updateLicenseSettings>[0]) {
    try { const r = await updateLicenseSettings(patch); setS(r); setMsg("ذخیره شد"); } catch (e) { setMsg(errMsg(e, "ذخیره ناموفق")); }
  }
  return (
    <div className="mt-5 flex flex-col gap-4">
      <Card className="p-5 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[14px] font-extrabold">API عمومی لایسنس</div>
            <div className="text-[12px] text-muted mt-1">غیرفعال‌کردن، همه‌ی فعال‌سازی/بررسی‌ها را api_disabled می‌کند (نصب‌های موجود طبق مهلت آفلاین کار می‌کنند).</div>
          </div>
          <button className={s.apiEnabled ? BTN_GHOST : BTN_PRIMARY} onClick={() => save({ apiEnabled: !s.apiEnabled })}>{s.apiEnabled ? "غیرفعال کردن" : "فعال کردن"}</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className={LABEL}>اعتبار هر توکن فعال‌سازی (روز؛ تمدید خودکار با check-in)</label><input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className={INPUT} /></div>
          <div><label className={LABEL}>نمونه‌برداری لاگ verify موفق (۱ از N)</label><input type="number" min={1} value={sample} onChange={(e) => setSample(Number(e.target.value))} className={INPUT} /></div>
        </div>
        <div className="flex items-center gap-3"><button className={BTN_PRIMARY} onClick={() => save({ tokenValidityDays: days, auditSampleEvery: sample })}>ذخیره</button>{msg ? <span className="text-[12px] text-muted">{msg}</span> : null}</div>
      </Card>
      <Card className="p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2"><div className="text-[14px] font-extrabold">کلید امضا</div>{s.signing.configured ? <Badge tone="success">پیکربندی‌شده</Badge> : <Badge tone="danger">پیکربندی نشده</Badge>}</div>
        {s.signing.configured ? (
          <>
            <div className="text-[12.5px]">kid: <span dir="ltr" className="font-mono font-bold">{s.signing.kid}</span> · نسخه‌ی CRL: {s.crlVersion}</div>
            <pre dir="ltr" className="bg-slate-50 border border-border rounded-xl p-3 text-[11px] overflow-x-auto text-left">{s.signing.publicKeyPem}</pre>
            <button className={`${BTN_GHOST} self-start`} onClick={() => copyText(s.signing.publicKeyPem ?? "")}>کپی کلید عمومی (برای بسته‌ی مشتری)</button>
          </>
        ) : (
          <p className="text-[12.5px] text-ink-soft leading-6">روی سرور اجرا کنید: <span dir="ltr" className="font-mono">npm run license:keygen</span> و مسیر فایل کلید خصوصی را در <span dir="ltr" className="font-mono">LICENSE_SIGNING_PRIVATE_KEY_FILE</span> بگذارید. کلید خصوصی هیچ‌گاه در این پنل نمایش داده نمی‌شود.</p>
        )}
      </Card>
    </div>
  );
}
