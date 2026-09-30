"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  fetchPaymentGatewaySettings,
  savePaymentGatewaySettings,
  ApiError,
  type PaymentGatewaySettings,
  type PaymentGatewayProvider,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors disabled:opacity-60";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const PROVIDERS: { value: PaymentGatewayProvider; label: string }[] = [
  { value: "ZARINPAL", label: "زرین‌پال" },
  { value: "BITPAY", label: "بیت‌پی (bitpay.ir)" },
];

export default function PaymentGatewaySettingsPage() {
  const { me } = useWorkspace();
  const isAdmin = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";

  const [settings, setSettings] = useState<PaymentGatewaySettings | null>(null);
  const [loading, setLoading] = useState(true);

  const [activeProvider, setActiveProvider] = useState<PaymentGatewayProvider | "">("");
  const [zarinpalMerchantId, setZarinpalMerchantId] = useState("");
  const [zarinpalSandbox, setZarinpalSandbox] = useState(true);
  const [bitpayApiKey, setBitpayApiKey] = useState("");
  const [bitpayTestMode, setBitpayTestMode] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function applySettings(s: PaymentGatewaySettings) {
    setSettings(s);
    setActiveProvider(s.activeProvider ?? "");
    setZarinpalSandbox(s.zarinpal.sandbox);
    setBitpayTestMode(s.bitpay.testMode);
    // فیلدهای رمز/مرچنت را از سرور پر نمی‌کنیم چون مقدار برگشتی ماسک‌شده است —
    // خالی می‌ماند تا فقط وقتی کاربر واقعاً مقدار جدیدی تایپ کند به سرور فرستاده شود.
    setZarinpalMerchantId("");
    setBitpayApiKey("");
  }

  useEffect(() => {
    fetchPaymentGatewaySettings()
      .then(applySettings)
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await savePaymentGatewaySettings({
        activeProvider: activeProvider || null,
        zarinpalMerchantId: zarinpalMerchantId.trim() || undefined,
        zarinpalSandbox,
        bitpayApiKey: bitpayApiKey.trim() || undefined,
        bitpayTestMode,
      });
      applySettings(result);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-[12.5px] text-muted">در حال بارگذاری...</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-extrabold text-ink">درگاه پرداخت</h1>
        <p className="text-[12.5px] text-muted mt-1">
          مرچنت‌کد زرین‌پال یا کلید API بیت‌پی خودتان را وصل کنید — این تنظیم توسط هر ماژول دیگری که نیاز به دریافت
          پول آنلاین دارد (پیش‌پرداخت رزرو، فاکتور فروش، فروشگاه آنلاین، بلیت رویداد و...) استفاده می‌شود. در هر لحظه
          فقط یک درگاه می‌تواند فعال باشد.
        </p>
      </div>

      <Card className="p-4">
        <form onSubmit={handleSave} className="flex flex-col gap-5">
          <div>
            <div className="text-[13px] font-bold text-ink mb-3">درگاه فعال</div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() => setActiveProvider("")}
                className={`text-[12px] font-bold px-3 py-2 rounded-xl border cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                  activeProvider === "" ? "bg-primary text-white border-primary" : "bg-slate-50 text-ink-soft border-border"
                }`}
              >
                غیرفعال
              </button>
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => setActiveProvider(p.value)}
                  className={`text-[12px] font-bold px-3 py-2 rounded-xl border cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
                    activeProvider === p.value ? "bg-primary text-white border-primary" : "bg-slate-50 text-ink-soft border-border"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {settings?.activeProvider ? (
                <Badge tone="accent">
                  در حال حاضر فعال: {PROVIDERS.find((p) => p.value === settings.activeProvider)?.label}
                </Badge>
              ) : (
                <Badge tone="neutral">هنوز هیچ درگاهی فعال نشده</Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="border border-border rounded-xl p-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-bold text-ink">زرین‌پال</span>
                {settings?.zarinpal.hasMerchantId ? <Badge tone="accent">مرچنت‌کد ثبت شده</Badge> : <Badge tone="neutral">تنظیم نشده</Badge>}
              </div>
              <div>
                <label className={labelClass}>مرچنت‌کد</label>
                <input
                  value={zarinpalMerchantId}
                  onChange={(e) => setZarinpalMerchantId(e.target.value)}
                  dir="ltr"
                  disabled={!isAdmin}
                  className={inputClass}
                  placeholder={settings?.zarinpal.merchantId || "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
                />
                {settings?.zarinpal.hasMerchantId ? (
                  <p className="text-[11px] text-muted mt-1">
                    مقدار فعلی: <span dir="ltr">{settings.zarinpal.merchantId}</span> — برای تغییر، مرچنت‌کد جدید را وارد کنید؛ برای نگه‌داشتن مقدار فعلی خالی بگذارید.
                  </p>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
                <input type="checkbox" checked={zarinpalSandbox} disabled={!isAdmin} onChange={(e) => setZarinpalSandbox(e.target.checked)} />
                حالت آزمایشی (sandbox) — تراکنش واقعی انجام نمی‌شود
              </label>
            </div>

            <div className="border border-border rounded-xl p-3.5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] font-bold text-ink">بیت‌پی (bitpay.ir)</span>
                {settings?.bitpay.hasApiKey ? <Badge tone="accent">کلید API ثبت شده</Badge> : <Badge tone="neutral">تنظیم نشده</Badge>}
              </div>
              <div>
                <label className={labelClass}>کلید API</label>
                <input
                  value={bitpayApiKey}
                  onChange={(e) => setBitpayApiKey(e.target.value)}
                  dir="ltr"
                  disabled={!isAdmin}
                  className={inputClass}
                  placeholder={settings?.bitpay.apiKey || "API Key"}
                />
                {settings?.bitpay.hasApiKey ? (
                  <p className="text-[11px] text-muted mt-1">
                    مقدار فعلی: <span dir="ltr">{settings.bitpay.apiKey}</span> — برای تغییر، کلید جدید را وارد کنید؛ برای نگه‌داشتن مقدار فعلی خالی بگذارید.
                  </p>
                ) : null}
              </div>
              <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
                <input type="checkbox" checked={bitpayTestMode} disabled={!isAdmin} onChange={(e) => setBitpayTestMode(e.target.checked)} />
                حالت آزمایشی
              </label>
            </div>
          </div>

          {isAdmin ? (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2.5 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                {saving ? "در حال ذخیره..." : "ذخیره تنظیمات"}
              </button>
              {saved ? <span className="text-[12px] text-emerald-600">ذخیره شد</span> : null}
              {error ? <span className="text-[12px] text-danger">{error}</span> : null}
            </div>
          ) : (
            <p className="text-[12px] text-muted">فقط مالک یا مدیر محیط کاری می‌تواند این تنظیمات را تغییر دهد.</p>
          )}
        </form>
      </Card>
    </div>
  );
}
