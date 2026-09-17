"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  fetchVoipProviders,
  fetchVoipConfig,
  saveVoipConfig,
  fetchVoipExtensions,
  fetchMyVoipExtension,
  saveMyVoipExtension,
  API_URL,
  ApiError,
  type VoipProvider,
  type VoipConfig,
  type VoipExtension,
  type MyVoipExtension,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export default function VoipSettingsPage() {
  const { me } = useWorkspace();
  const [providers, setProviders] = useState<VoipProvider[]>([]);
  const [config, setConfig] = useState<VoipConfig>(null);
  const [providerCode, setProviderCode] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [extensions, setExtensions] = useState<VoipExtension[]>([]);
  const [myExtension, setMyExtension] = useState("");
  const [mySipUsername, setMySipUsername] = useState("");
  const [mySipPassword, setMySipPassword] = useState("");
  const [savingExtension, setSavingExtension] = useState(false);

  useEffect(() => {
    fetchVoipProviders().then(setProviders).catch(() => setProviders([]));
    fetchVoipConfig()
      .then((c) => {
        setConfig(c);
        if (c) {
          setProviderCode(c.providerCode);
          setFieldValues(Object.fromEntries(Object.entries(c.config).map(([k, v]) => [k, String(v ?? "")])));
        }
      })
      .catch(() => {});
    fetchVoipExtensions().then(setExtensions).catch(() => setExtensions([]));
    fetchMyVoipExtension()
      .then((e: MyVoipExtension) => {
        if (!e) return;
        setMyExtension(e.extension);
        setMySipUsername(e.sipUsername ?? "");
        setMySipPassword(e.sipPassword ?? "");
      })
      .catch(() => {});
  }, []);

  const selectedProvider = providers.find((p) => p.code === providerCode);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!providerCode) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveVoipConfig({ providerCode, config: fieldValues });
      setConfig(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveExtension(e?: React.SyntheticEvent) {
    e?.preventDefault();
    if (!myExtension.trim()) return;
    setSavingExtension(true);
    try {
      await saveMyVoipExtension({
        extension: myExtension.trim(),
        sipUsername: mySipUsername.trim() || undefined,
        sipPassword: mySipPassword.trim() || undefined,
      });
      fetchVoipExtensions().then(setExtensions).catch(() => {});
    } finally {
      setSavingExtension(false);
    }
  }

  const webhookUrl = config && me ? `${API_URL}/public/voip/webhook/${me.tenant.slug}/${config.providerCode}?secret=${config.webhookSecret}` : null;
  const sipDomain = typeof config?.config.sipDomain === "string" ? config.config.sipDomain : null;

  return (
    <div className="flex flex-col gap-6 max-w-[640px]">
      <div>
        <h1 className="text-lg font-extrabold mb-1">اتصال تلفن سازمانی (VoIP)</h1>
        <p className="text-[12.5px] text-muted">
          سرویس/سانترال VoIP سازمان را انتخاب کنید. آدرس وب‌هوک زیر را در پنل همان سرویس، برای رویداد «تماس ورودی» تنظیم کنید.
        </p>
      </div>

      <Card className="p-4">
        <form onSubmit={handleSaveConfig} className="flex flex-col gap-3.5">
          <div>
            <label className={labelClass}>سرویس VoIP</label>
            <select value={providerCode} onChange={(e) => { setProviderCode(e.target.value); setFieldValues({}); }} className={inputClass}>
              <option value="">انتخاب کنید...</option>
              {providers.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {selectedProvider?.configFields.map((f) => (
            <div key={f.key}>
              <label className={labelClass}>{f.label}</label>
              <input
                value={fieldValues[f.key] ?? ""}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                className={inputClass}
                dir="ltr"
              />
            </div>
          ))}

          {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          <button
            type="submit"
            disabled={saving || !providerCode}
            className="self-start text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </form>

        {webhookUrl ? (
          <div className="mt-4 pt-4 border-t border-border">
            <label className={labelClass}>آدرس وب‌هوک (برای تنظیم در پنل سرویس VoIP)</label>
            <div className="text-[11.5px] bg-slate-50 border border-border rounded-lg px-3 py-2 break-all" dir="ltr">
              {webhookUrl}
            </div>
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-bold mb-1">داخلی VoIP من</div>
        <p className="text-[11px] text-muted mb-3">
          وقتی تماسی به این داخلی برسد، پاپ‌آپ آن روی پنل شما نمایش داده می‌شود.
        </p>
        <form onSubmit={handleSaveExtension} className="flex flex-col gap-3">
          <div>
            <label className={labelClass}>داخلی (برای پاپ‌آپ تماس ورودی)</label>
            <input
              value={myExtension}
              onChange={(e) => setMyExtension(e.target.value)}
              placeholder="مثلاً 101"
              className={inputClass}
              dir="ltr"
            />
          </div>
          <button
            type="submit"
            disabled={savingExtension || !myExtension.trim()}
            className="self-start text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            {savingExtension ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </form>

        {extensions.length > 0 ? (
          <div className="mt-4 pt-4 border-t border-border flex flex-col gap-1.5">
            {extensions.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-[12px]">
                <span>{e.user.name}</span>
                <span className="text-muted" dir="ltr">
                  {e.extension}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-bold mb-1">اتصال تلفن IP / سافت‌فون من</div>
        <p className="text-[11px] text-muted mb-3">
          این سه مقدار را داخل تنظیمات تلفن IP یا اپلیکیشن سافت‌فون خودتان وارد کنید تا مستقیماً به سانترال سازمان
          وصل شوید و بتوانید تماس بگیرید/دریافت کنید — جدا از «داخلی» بالا که فقط برای پاپ‌آپ روی همین پنل است.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label className={labelClass}>دامنه‌ی سرور (SIP Domain)</label>
            <div className={`${inputClass} bg-slate-100 text-muted`} dir="ltr">
              {sipDomain ?? "—"}
            </div>
          </div>
          <div>
            <label className={labelClass}>نام کاربری (Username)</label>
            <input
              value={mySipUsername}
              onChange={(e) => setMySipUsername(e.target.value)}
              placeholder="مثلاً 989908008011"
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
        </div>
        <button
          onClick={handleSaveExtension}
          disabled={savingExtension || !myExtension.trim()}
          className="mt-3 self-start text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
        >
          {savingExtension ? "در حال ذخیره..." : "ذخیره اطلاعات اتصال"}
        </button>
        {!sipDomain ? (
          <p className="text-[11px] text-danger mt-2">
            ابتدا دامنه‌ی SIP را در بخش «سرویس VoIP» بالا (فیلد دامنه‌ی ثبت‌نام) وارد و ذخیره کنید.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
