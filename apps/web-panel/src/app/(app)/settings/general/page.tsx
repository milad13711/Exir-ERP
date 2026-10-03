"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  fetchGeneralSettings,
  updateGeneralSettings,
  updateBranding,
  updateCompanyStamp,
  downloadBackupExport,
  uploadBackupImport,
  ApiError,
  type GeneralSettings,
} from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

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
  const { me } = useWorkspace();
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [orgName, setOrgName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [address, setAddress] = useState("");
  const [economicCode, setEconomicCode] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [themeColor, setThemeColor] = useState("#4338ca");
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

  useEffect(() => {
    if (me?.tenant.themeColor) setThemeColor(me.tenant.themeColor);
  }, [me]);

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
      await updateBranding({ themeColor });
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
              <label className={labelClass}>رنگ اصلی (تم وب‌اپ روی گوشی)</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className="w-11 h-11 rounded-lg border border-border cursor-pointer bg-transparent p-0.5"
                />
                <input
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                  className={inputClass}
                  dir="ltr"
                />
              </div>
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

      {settings?.canManageStamp ? (
        <CompanyStampCard signatureImage={settings.signatureImage} stampImage={settings.stampImage} />
      ) : null}

      <BackupExportCard />
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function ImageSlot({
  label,
  value,
  onChange,
  onRemove,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (dataUrl: string) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange(await readAsDataUrl(file));
  }

  return (
    <div className="bg-slate-50 border border-border rounded-xl p-3.5">
      <div className="text-[12px] font-semibold text-ink-soft mb-2">{label}</div>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt={label} className="h-16 mb-2 bg-white rounded-lg p-1.5 border border-border" />
      ) : (
        <div className="h-16 mb-2 flex items-center justify-center text-[11.5px] text-muted bg-white rounded-lg border border-dashed border-border">
          تصویری ثبت نشده
        </div>
      )}
      <div className="flex items-center gap-2">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
        >
          {value ? "تغییر تصویر" : "بارگذاری تصویر"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={onRemove}
            className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer"
          >
            حذف تصویر
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CompanyStampCard({ signatureImage, stampImage }: { signatureImage: string | null; stampImage: string | null }) {
  const [signature, setSignature] = useState<string | null | undefined>(signatureImage);
  const [stamp, setStamp] = useState<string | null | undefined>(stampImage);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateCompanyStamp({ signatureImage: signature, stampImage: stamp });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "خطایی رخ داد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mt-5 p-6 max-w-[540px]">
      <div className="text-[13px] font-bold mb-1">مهر و امضای رسمی شرکت</div>
      <p className="text-[12px] text-muted leading-relaxed mb-4">
        این تصاویر تنها منبع مهر و امضای رسمی برای همه‌ی اسناد سیستم (قرارداد، شرایط همکاری و ...) هستند — فقط شما
        (مالک محیط کاری) می‌توانید این تصاویر را تغییر دهید. دسترسی «استفاده» از این مهر برای امضای اسناد از طرف
        شرکت را می‌توانید در تنظیمات پروفایل خودتان به یک کاربر دیگر ارجاع دهید.
      </p>
      <div className="flex flex-col gap-3">
        <ImageSlot label="تصویر امضا" value={signature} onChange={setSignature} onRemove={() => setSignature(null)} />
        <ImageSlot label="تصویر مهر" value={stamp} onChange={setStamp} onRemove={() => setStamp(null)} />
      </div>
      {error ? <div className="text-[12px] text-danger mt-3">{error}</div> : null}
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {saving ? "در حال ذخیره..." : "ذخیره"}
        </button>
        {saved ? <span className="text-[12.5px] text-success font-semibold">ذخیره شد ✓</span> : null}
      </div>
    </Card>
  );
}

function BackupExportCard() {
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleDownload(format: "sql" | "json") {
    setDownloading(true);
    setError(null);
    try {
      await downloadBackupExport(format);
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
        یک نسخه‌ی کامل SQL فشرده (.sql.gz) از تمام داده‌های این محیط کاری — همه‌ی ماژول‌ها — دانلود می‌شود. بکاپ
        خودکار روزانه هم با همین قالب ذخیره می‌شود.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => handleDownload("sql")}
          disabled={downloading}
          className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          {downloading ? "در حال آماده‌سازی..." : "دانلود پشتیبان کامل (SQL)"}
        </button>
        <button
          onClick={() => handleDownload("json")}
          disabled={downloading}
          className="px-4 py-2.5 rounded-xl bg-slate-100 text-ink-soft text-[12.5px] font-bold cursor-pointer disabled:opacity-50"
        >
          فایل JSON (قابل بازیابی از همین‌جا)
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
        «بازیابی از فایل پشتیبان» فقط فایل JSON را می‌پذیرد و فقط روی یک محیط کاری کاملاً خالی مجاز است. بازگردانیِ
        فایل SQL توسط مدیر سرور انجام می‌شود: gunzip -c backup.sql.gz | psql ‹نام دیتابیس›
      </p>
      {error ? <div className="text-[12px] text-danger mt-2">{error}</div> : null}
      {importResult ? <div className="text-[12px] text-success mt-2">{importResult}</div> : null}
    </Card>
  );
}
