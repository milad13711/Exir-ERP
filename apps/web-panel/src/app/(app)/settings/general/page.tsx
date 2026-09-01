"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  fetchGeneralSettings,
  updateGeneralSettings,
  downloadBackupExport,
  uploadBackupImport,
  ApiError,
  type GeneralSettings,
} from "@/lib/api";

const TIMEZONE_OPTIONS = [
  { value: "Asia/Tehran", label: "تهران (Asia/Tehran)" },
  { value: "Asia/Dubai", label: "دبی (Asia/Dubai)" },
  { value: "Europe/Istanbul", label: "استانبول (Europe/Istanbul)" },
  { value: "UTC", label: "UTC" },
];

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

export default function GeneralSettingsPage() {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [orgName, setOrgName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [address, setAddress] = useState("");
  const [economicCode, setEconomicCode] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchGeneralSettings().then((s) => {
      setSettings(s);
      setOrgName(s.orgName);
      setLogoUrl(s.logoUrl ?? "");
      setTimezone(s.timezone);
      setAddress(s.address ?? "");
      setEconomicCode(s.economicCode ?? "");
      setNationalId(s.nationalId ?? "");
      setRegistrationNumber(s.registrationNumber ?? "");
      setPhone(s.phone ?? "");
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateGeneralSettings({
        orgName: orgName.trim(),
        logoUrl: logoUrl.trim() || undefined,
        timezone,
        address: address.trim(),
        economicCode: economicCode.trim(),
        nationalId: nationalId.trim(),
        registrationNumber: registrationNumber.trim(),
        phone: phone.trim(),
      });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold">عمومی و برندینگ</h1>
      <p className="text-[13.5px] text-muted mt-1">
        نام سازمان، لوگو، منطقه زمانی و اطلاعات ثبتی — همین اطلاعات در فاکتورها و فایل‌های PDF نمایش داده می‌شود
      </p>

      <Card className="mt-6 p-6 max-w-[540px]">
        {settings === null ? (
          <div className="py-6 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-soft border border-border flex items-center justify-center overflow-hidden shrink-0">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="لوگو" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-primary font-extrabold text-lg">
                    {orgName.trim().slice(0, 1) || "ا"}
                  </span>
                )}
              </div>
              <div className="flex-1">
                <label className={labelClass}>آدرس لوگو (URL)</label>
                <input
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
                  dir="ltr"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>نام سازمان</label>
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className={inputClass} />
            </div>

            <div>
              <label className={labelClass}>منطقه زمانی</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClass}>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="border-t border-border pt-4 mt-1">
              <div className="text-[13px] font-bold mb-3">اطلاعات ثبتی و تماس</div>
              <div className="flex flex-col gap-4">
                <div>
                  <label className={labelClass}>آدرس شرکت</label>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>تلفن</label>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} dir="ltr" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>کد اقتصادی</label>
                    <input
                      value={economicCode}
                      onChange={(e) => setEconomicCode(e.target.value)}
                      className={inputClass}
                      dir="ltr"
                    />
                  </div>
                  <div>
                    <label className={labelClass}>شناسه ملی</label>
                    <input
                      value={nationalId}
                      onChange={(e) => setNationalId(e.target.value)}
                      className={inputClass}
                      dir="ltr"
                    />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>شماره ثبت شرکت</label>
                  <input
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    className={inputClass}
                    dir="ltr"
                  />
                </div>
              </div>
            </div>

            {error ? <div className="text-[12px] text-danger">{error}</div> : null}

            <div className="flex items-center gap-3 mt-1.5">
              <button
                type="submit"
                disabled={saving || !orgName.trim()}
                className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
              >
                {saving ? "در حال ذخیره..." : "ذخیره تغییرات"}
              </button>
              {saved ? <span className="text-[12.5px] text-success font-semibold">ذخیره شد ✓</span> : null}
            </div>
          </form>
        )}
      </Card>

      <BackupExportCard />
    </div>
  );
}

function BackupExportCard() {
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadBackupExport();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setDownloading(false);
    }
  }

  function handlePickFile() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (
      !window.confirm(
        "این عملیات فقط روی یک محیط کاری کاملاً خالی (بدون مخاطب یا فاکتور) مجاز است و تمام داده‌های فایل را جایگزین می‌کند. ادامه می‌دهید؟",
      )
    ) {
      return;
    }
    setUploading(true);
    setError(null);
    setImportResult(null);
    try {
      await uploadBackupImport(file);
      setImportResult("بازیابی با موفقیت انجام شد.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="p-6 mt-5">
      <h2 className="text-[15px] font-extrabold text-ink mb-1">پشتیبان‌گیری و خروجی داده</h2>
      <p className="text-[12.5px] text-muted mb-4">
        یک فایل JSON شامل تمام داده‌های اصلی این محیط کاری (مخاطبین، فاکتورها، کالاها، اسناد حسابداری و...) دانلود
        می‌شود. این فایل برای آرشیو یا انتقال داده است.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {downloading ? "در حال آماده‌سازی..." : "دانلود پشتیبان کامل (JSON)"}
        </button>
        <button
          onClick={handlePickFile}
          disabled={uploading}
          className="px-5 py-2.5 rounded-xl bg-danger-soft text-danger text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {uploading ? "در حال بازیابی..." : "بازیابی از فایل پشتیبان"}
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFileSelected} className="hidden" />
      </div>
      <p className="text-[11.5px] text-muted mt-2">
        بازیابی فقط روی یک محیط کاری کاملاً خالی (بدون هیچ مخاطب یا فاکتوری) مجاز است — برای بازگردانی بعد از از دست
        رفتن داده، نه برای ادغام با داده‌ی فعلی.
      </p>
      {error ? <div className="text-[12px] text-danger mt-2">{error}</div> : null}
      {importResult ? <div className="text-[12px] text-success mt-2">{importResult}</div> : null}
    </Card>
  );
}
