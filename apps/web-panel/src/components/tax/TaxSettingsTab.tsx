"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatJalaliDateTime } from "@/lib/persian";
import { ApiError, fetchTaxSettings, refreshTaxServerKey, removeTaxKey, saveTaxSettings, uploadTaxKey, type TaxSettings } from "@/lib/api";
import { inputClass, labelClass } from "./constants";

const btn = "text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50";

/** تنظیمات اتصال به مودیان — فقط مالک/مدیر؛ کلید خصوصی فقط بارگذاری می‌شود و هرگز نمایش داده نمی‌شود. */
export function TaxSettingsTab({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => void }) {
  const [s, setS] = useState<TaxSettings | null>(null);
  const [form, setForm] = useState({ economicCode: "", fiscalId: "", taxpayerName: "", postalCode: "", branchCode: "", sandboxBaseUrl: "", defaultVatRate: "", defaultSstid: "", defaultUnitCode: "" });
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [certificatePem, setCertificatePem] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function hydrate(v: TaxSettings) {
    setS(v);
    setForm({
      economicCode: v.economicCode ?? "",
      fiscalId: v.fiscalId ?? "",
      taxpayerName: v.taxpayerName ?? "",
      postalCode: v.postalCode ?? "",
      branchCode: v.branchCode ?? "",
      sandboxBaseUrl: v.sandboxBaseUrl ?? "",
      defaultVatRate: v.defaultVatRate === null ? "" : String(v.defaultVatRate),
      defaultSstid: v.defaultSstid ?? "",
      defaultUnitCode: v.defaultUnitCode === null ? "" : String(v.defaultUnitCode),
    });
  }

  useEffect(() => {
    if (!isAdmin) return;
    fetchTaxSettings().then(hydrate).catch((e) => setMsg({ tone: "err", text: e instanceof ApiError ? e.message : "بارگذاری تنظیمات ناموفق بود" }));
  }, [isAdmin]);

  async function run(fn: () => Promise<TaxSettings>, okText: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      hydrate(await fn());
      setMsg({ tone: "ok", text: okText });
      onChanged();
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof ApiError ? e.message : "عملیات ناموفق بود" });
    } finally {
      setBusy(false);
    }
  }

  async function readFile(file: File | undefined, set: (v: string) => void) {
    if (file) set(await file.text());
  }

  if (!isAdmin) return <Card className="p-6 text-center text-muted text-sm">فقط مالک یا مدیر می‌تواند تنظیمات مالیات را ببیند و تغییر دهد.</Card>;
  if (!s) return <div className="p-8 text-center text-muted text-sm">{msg?.text ?? "در حال بارگذاری..."}</div>;

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  return (
    <div className="space-y-4">
      {msg ? <div className={`text-[12.5px] rounded-xl px-3 py-2 ${msg.tone === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{msg.text}</div> : null}
      {!s.secretsKeyConfigured ? (
        <div className="text-[12.5px] bg-danger-soft text-danger rounded-xl px-3 py-2">
          کلید رمزنگاری سرور (متغیر محیطی TAX_SECRETS_KEY) تنظیم نشده است؛ تا آن زمان بارگذاری کلید خصوصی غیرفعال است. این مورد را به مدیر سرور اطلاع دهید.
        </div>
      ) : null}

      <Card className="p-5">
        <div className="text-[13.5px] font-extrabold mb-3">آمادگی ارسال</div>
        <ul className="space-y-1.5">
          {s.readiness.map((r) => (
            <li key={r.key} className="flex items-center gap-2 text-[12.5px]">
              <Badge tone={r.ok ? "success" : "warning"}>{r.ok ? "انجام شد" : "ناقص"}</Badge>
              {r.label}
            </li>
          ))}
        </ul>
        <div className="text-[11.5px] text-muted mt-3">
          محیط آزمایشی تأیید شده: {s.verifiedAgainstSandboxAt ? formatJalaliDateTime(s.verifiedAgainstSandboxAt) : "هنوز نه — با نخستین صورتحساب پذیرفته‌شده در محیط آزمایشی ثبت می‌شود"}
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-[13.5px] font-extrabold mb-3">مشخصات مودی</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>شماره اقتصادی (۱۰ یا ۱۴ رقم)</label>
            <input dir="ltr" className={inputClass} value={form.economicCode} onChange={(e) => setForm({ ...form, economicCode: e.target.value.trim() })} />
          </div>
          <div>
            <label className={labelClass}>شناسه یکتای حافظه مالیاتی (۶ نویسه)</label>
            <input dir="ltr" maxLength={6} className={inputClass} value={form.fiscalId} onChange={(e) => setForm({ ...form, fiscalId: e.target.value.trim() })} />
          </div>
          <div>
            <label className={labelClass}>نام مودی</label>
            <input className={inputClass} value={form.taxpayerName} onChange={(e) => setForm({ ...form, taxpayerName: e.target.value })} />
          </div>
          <div>
            <label className={labelClass}>کد پستی</label>
            <input dir="ltr" maxLength={10} className={inputClass} value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value.trim() })} />
          </div>
          <div>
            <label className={labelClass}>نرخ پیش‌فرض ارزش افزوده (درصد)</label>
            <input dir="ltr" className={inputClass} value={form.defaultVatRate} onChange={(e) => setForm({ ...form, defaultVatRate: e.target.value })} placeholder="خالی = تعیین نشده" />
          </div>
          <div>
            <label className={labelClass}>کد شعبه فروشنده (اختیاری)</label>
            <input dir="ltr" className={inputClass} value={form.branchCode} onChange={(e) => setForm({ ...form, branchCode: e.target.value.trim() })} />
          </div>
          <div>
            <label className={labelClass}>شناسه کالا/خدمت پیش‌فرض (۱۳ رقم)</label>
            <input dir="ltr" maxLength={13} className={inputClass} value={form.defaultSstid} onChange={(e) => setForm({ ...form, defaultSstid: e.target.value.trim() })} />
          </div>
          <div>
            <label className={labelClass}>کد واحد اندازه‌گیری پیش‌فرض</label>
            <input dir="ltr" className={inputClass} value={form.defaultUnitCode} onChange={(e) => setForm({ ...form, defaultUnitCode: e.target.value.trim() })} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>آدرس محیط آزمایشی (https و در دامنه‌ی tax.gov.ir)</label>
            <input dir="ltr" className={inputClass} value={form.sandboxBaseUrl} onChange={(e) => setForm({ ...form, sandboxBaseUrl: e.target.value.trim() })} placeholder="آدرس را از سازمان امور مالیاتی بگیرید" />
          </div>
        </div>
        <div className="mt-4">
          <button
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  saveTaxSettings({
                    economicCode: form.economicCode,
                    fiscalId: form.fiscalId,
                    taxpayerName: form.taxpayerName,
                    postalCode: form.postalCode,
                    branchCode: form.branchCode,
                    sandboxBaseUrl: form.sandboxBaseUrl,
                    defaultVatRate: num(form.defaultVatRate),
                    defaultSstid: form.defaultSstid,
                    defaultUnitCode: num(form.defaultUnitCode),
                  }),
                "تنظیمات ذخیره شد",
              )
            }
            className={`${btn} bg-primary text-white`}
          >
            ذخیره
          </button>
          <span className="text-[11.5px] text-muted mr-3">تغییر شماره اقتصادی یا شناسه حافظه، ارسال را خاموش و تأیید آزمایشی را باطل می‌کند.</span>
        </div>
      </Card>

      <Card className="p-5">
        <div className="text-[13.5px] font-extrabold mb-1">کلید و گواهی امضا</div>
        <div className="text-[12px] text-muted mb-3">کلید خصوصی RSA (حداقل ۲۰۴۸ بیت، PEM بدون رمز) پس از بارگذاری رمزنگاری می‌شود و هرگز دوباره نمایش داده نمی‌شود.</div>
        {s.hasPrivateKey ? (
          <div className="text-[12.5px] mb-3 space-y-1">
            <div><Badge tone="success">کلید بارگذاری شده</Badge></div>
            <div className="text-muted">اثرانگشت کلید: <span dir="ltr" className="font-mono break-all">{s.keyFingerprint}</span></div>
            {s.hasCertificate ? <div className="text-muted">گواهی: <span dir="ltr" className="font-mono break-all">{s.certFingerprint}</span> — اعتبار تا {s.certValidTo ? formatJalaliDateTime(s.certValidTo) : "—"}</div> : null}
          </div>
        ) : (
          <div className="mb-3"><Badge tone="warning">کلیدی بارگذاری نشده</Badge></div>
        )}
        <label className={labelClass}>کلید خصوصی (PEM) — پرونده یا متن</label>
        <input type="file" accept=".pem,.key,.txt" onChange={(e) => readFile(e.target.files?.[0], setPrivateKeyPem)} className="text-[12px] mb-2" />
        <textarea dir="ltr" rows={3} className={inputClass} value={privateKeyPem} onChange={(e) => setPrivateKeyPem(e.target.value)} placeholder="-----BEGIN PRIVATE KEY-----" />
        <label className={`${labelClass} mt-3`}>گواهی عمومی (PEM، اختیاری)</label>
        <input type="file" accept=".pem,.crt,.cer,.txt" onChange={(e) => readFile(e.target.files?.[0], setCertificatePem)} className="text-[12px] mb-2" />
        <textarea dir="ltr" rows={2} className={inputClass} value={certificatePem} onChange={(e) => setCertificatePem(e.target.value)} placeholder="-----BEGIN CERTIFICATE-----" />
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <button
            disabled={busy || !privateKeyPem.trim() || !s.secretsKeyConfigured}
            onClick={() =>
              run(
                async () => {
                  const r = await uploadTaxKey({ privateKeyPem, ...(certificatePem.trim() ? { certificatePem } : {}) });
                  setPrivateKeyPem("");
                  setCertificatePem("");
                  return r;
                },
                "کلید بارگذاری شد؛ ارسال خاموش و محیط روی آزمایشی قرار گرفت.",
                "با بارگذاری کلید جدید، ارسال خاموش و تأیید آزمایشی باطل می‌شود. ادامه می‌دهید؟",
              )
            }
            className={`${btn} bg-primary text-white`}
          >
            بارگذاری کلید
          </button>
          {s.hasPrivateKey ? (
            <button disabled={busy} onClick={() => run(removeTaxKey, "کلید حذف شد", "کلید خصوصی ذخیره‌شده حذف شود؟")} className={`${btn} bg-surface border border-border text-danger`}>
              حذف کلید
            </button>
          ) : null}
          <button disabled={busy} onClick={() => run(refreshTaxServerKey, "کلید عمومی سازمان دریافت شد")} className={`${btn} bg-surface border border-border text-ink-soft`}>
            دریافت کلید سرور
          </button>
          <span className="text-[11.5px] text-muted">
            {s.serverPublicKeyId ? `کلید سرور: ${s.serverPublicKeyId.slice(0, 8)}…` : "کلید سرور هنوز دریافت نشده"}
          </span>
        </div>
      </Card>

      <Card className="p-5 border-warning">
        <div className="text-[13.5px] font-extrabold mb-2">محیط و ارسال واقعی</div>
        <div className="text-[12.5px] bg-warning-soft text-warning rounded-xl px-3 py-2 mb-3 leading-6">
          هشدار: با «فعال‌سازی ارسال»، صورتحساب‌های تأییدشده‌ی مدیر به‌صورت خودکار به سامانه مودیان ارسال می‌شوند. ارسال به محیط واقعی بر اساس مقررات برگشت‌پذیر نیست و فقط پس از یک پذیرش موفق در محیط آزمایشی امکان‌پذیر است. تغییر محیط، ارسال را خودکار خاموش می‌کند.
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <span className="text-[12.5px] font-semibold">محیط:</span>
          {(["SANDBOX", "PRODUCTION"] as const).map((env) => (
            <button
              key={env}
              disabled={busy || s.environment === env}
              onClick={() => run(() => saveTaxSettings({ environment: env }), env === "SANDBOX" ? "محیط آزمایشی انتخاب شد" : "محیط واقعی انتخاب شد؛ ارسال خاموش است", env === "PRODUCTION" ? "محیط به «واقعی» تغییر کند؟ ارسال خاموش می‌شود و باید دوباره آگاهانه فعال شود." : undefined)}
              className={`text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border cursor-pointer disabled:cursor-default ${s.environment === env ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft"}`}
            >
              {env === "SANDBOX" ? "آزمایشی" : "واقعی"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Badge tone={s.sendingEnabled ? "danger" : "neutral"}>{s.sendingEnabled ? "ارسال فعال است" : "ارسال واقعی غیرفعال است"}</Badge>
          <button
            disabled={busy}
            onClick={() =>
              run(
                () => saveTaxSettings({ sendingEnabled: !s.sendingEnabled }),
                s.sendingEnabled ? "ارسال غیرفعال شد" : "ارسال فعال شد",
                s.sendingEnabled ? undefined : `ارسال صورتحساب‌های تأییدشده به سامانه مودیان (محیط ${s.environment === "PRODUCTION" ? "واقعی" : "آزمایشی"}) فعال شود؟`,
              )
            }
            className={`${btn} ${s.sendingEnabled ? "bg-surface border border-border text-ink-soft" : "bg-danger text-white"}`}
          >
            {s.sendingEnabled ? "غیرفعال‌سازی ارسال" : "فعال‌سازی ارسال"}
          </button>
        </div>
      </Card>
    </div>
  );
}
