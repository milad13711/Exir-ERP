"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { fetchVoipConfig, saveVoipConfig, fetchMyVoipExtension, saveMyVoipExtension, ApiError, type VoipConfig } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

const VOIP_PROVIDER_CODE = "novatel";

export default function VoipSettingsPage() {
  const { me } = useWorkspace();
  const isAdmin = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";

  const [config, setConfig] = useState<VoipConfig>(null);
  const [sipDomain, setSipDomain] = useState("");
  const [wssUrl, setWssUrl] = useState("");
  const [savingDomain, setSavingDomain] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);

  const [mySipUsername, setMySipUsername] = useState("");
  const [mySipPassword, setMySipPassword] = useState("");
  const [savingMine, setSavingMine] = useState(false);
  const [mineError, setMineError] = useState<string | null>(null);
  const [mineSaved, setMineSaved] = useState(false);

  useEffect(() => {
    fetchVoipConfig()
      .then((c) => {
        setConfig(c);
        const domain = c?.config.sipDomain;
        if (typeof domain === "string") setSipDomain(domain);
        const wss = c?.config.wssUrl;
        if (typeof wss === "string") setWssUrl(wss);
      })
      .catch(() => {});
    fetchMyVoipExtension()
      .then((e) => {
        if (!e) return;
        setMySipUsername(e.sipUsername ?? "");
        setMySipPassword(e.sipPassword ?? "");
      })
      .catch(() => {});
  }, []);

  async function handleSaveDomain(e: React.FormEvent) {
    e.preventDefault();
    if (!sipDomain.trim()) return;
    setSavingDomain(true);
    setDomainError(null);
    try {
      const saved = await saveVoipConfig({
        providerCode: VOIP_PROVIDER_CODE,
        config: { sipDomain: sipDomain.trim(), wssUrl: wssUrl.trim() || undefined },
      });
      setConfig(saved);
    } catch (err) {
      setDomainError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSavingDomain(false);
    }
  }

  async function handleSaveMine(e: React.FormEvent) {
    e.preventDefault();
    if (!mySipUsername.trim() || !mySipPassword.trim()) return;
    setSavingMine(true);
    setMineError(null);
    setMineSaved(false);
    try {
      await saveMyVoipExtension({ extension: undefined, sipUsername: mySipUsername.trim(), sipPassword: mySipPassword.trim() });
      setMineSaved(true);
    } catch (err) {
      setMineError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSavingMine(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-[560px]">
      <div>
        <h1 className="text-lg font-extrabold mb-1">اتصال تلفن IP (VoIP)</h1>
        <p className="text-[12.5px] text-muted">
          این مقادیر را داخل تنظیمات تلفن IP یا اپلیکیشن سافت‌فون خودتان وارد کنید تا مستقیماً به سانترال سازمان
          وصل شوید و بتوانید تماس بگیرید یا دریافت کنید. پس از اتصال، از آیکون تلفن در بالای صفحه می‌توانید شماره
          بگیرید یا از مخاطبین تماس بگیرید، و تاریخچه‌ی همه‌ی تماس‌ها (ورودی، خروجی و از دست رفته) هم در همان آیکون و
          هم در «تاریخچه تماس‌ها» از منوی اصلی و روی پروفایل هر مخاطب ثبت می‌شود.
        </p>
      </div>

      {isAdmin ? (
        <Card className="p-4">
          <form onSubmit={handleSaveDomain} className="flex flex-col gap-3">
            <div>
              <label className={labelClass}>دامنه‌ی سرور (SIP Domain)</label>
              <input
                value={sipDomain}
                onChange={(e) => setSipDomain(e.target.value)}
                className={inputClass}
                dir="ltr"
              />
            </div>
            <div>
              <label className={labelClass}>آدرس WebSocket برای تماس مستقیم از مرورگر (اختیاری)</label>
              <input
                value={wssUrl}
                onChange={(e) => setWssUrl(e.target.value)}
                placeholder="wss://voice.navaphone.com:8089/ws"
                className={inputClass}
                dir="ltr"
              />
              <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                اگر پر شود، تماس خروجی و ورودی مستقیماً در همین مرورگر برقرار می‌شود (بدون نیاز به تلفن IP جدا) —
                دقیقاً مثل ویجت تلفن Odoo. آدرس دقیق را از پشتیبانی سرویس VoIP خودتان بپرسید.
              </p>
            </div>
            {domainError ? <div className="text-[12px] text-danger">{domainError}</div> : null}
            <button
              type="submit"
              disabled={savingDomain || !sipDomain.trim()}
              className="self-start text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
            >
              {savingDomain ? "در حال ذخیره..." : "ذخیره تنظیمات"}
            </button>
          </form>
        </Card>
      ) : null}

      <Card className="p-4">
        <div className="text-[13px] font-bold mb-3">اتصال من</div>
        <form onSubmit={handleSaveMine} className="flex flex-col gap-3">
          <div>
            <label className={labelClass}>دامنه‌ی سرور (SIP Domain)</label>
            <div className={`${inputClass} bg-slate-100 text-muted`} dir="ltr">
              {config?.config.sipDomain && typeof config.config.sipDomain === "string" ? config.config.sipDomain : "—"}
            </div>
          </div>
          <div>
            <label className={labelClass}>نام کاربری (Username)</label>
            <input
              value={mySipUsername}
              onChange={(e) => setMySipUsername(e.target.value)}
              className={inputClass}
              dir="ltr"
            />
          </div>
          <div>
            <label className={labelClass}>رمز عبور (Password)</label>
            <input
              value={mySipPassword}
              onChange={(e) => setMySipPassword(e.target.value)}
              type="text"
              className={inputClass}
              dir="ltr"
            />
          </div>
          {mineError ? <div className="text-[12px] text-danger">{mineError}</div> : null}
          {mineSaved ? <div className="text-[12px] text-success">ذخیره شد</div> : null}
          <button
            type="submit"
            disabled={savingMine || !mySipUsername.trim() || !mySipPassword.trim()}
            className="self-start text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            {savingMine ? "در حال ذخیره..." : "ذخیره اطلاعات اتصال"}
          </button>
        </form>
        {!config?.config.sipDomain ? (
          <p className="text-[11px] text-danger mt-3">
            {isAdmin
              ? "ابتدا دامنه‌ی سرور را در بخش بالا وارد و ذخیره کنید."
              : "دامنه‌ی سرور هنوز توسط مدیر سیستم تنظیم نشده است."}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
