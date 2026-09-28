"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  updateCertificateTemplateSettings,
  type CertificateTemplateSettings,
  type CertificateFieldKey,
  type CertificateFieldPosition,
} from "@/lib/api";

const FIELD_LABELS: Record<CertificateFieldKey, string> = {
  recipientName: "نام گیرنده",
  title: "عنوان گواهی",
  body: "متن گواهی",
  items: "آیتم‌ها (بولت)",
  nationalId: "شماره ملی (مستقل)",
  companyName: "نام شرکت (مستقل)",
  code: "کد گواهی",
  issueDate: "تاریخ صدور",
  qr: "QR",
  stamp: "مهر",
  signature: "امضا",
};

const FIELD_KEYS = Object.keys(FIELD_LABELS) as CertificateFieldKey[];
const IMAGE_KEYS: CertificateFieldKey[] = ["qr", "stamp", "signature"];
const isTextKey = (key: CertificateFieldKey) => !IMAGE_KEYS.includes(key);

/** عرض صفحه‌ی گواهی A4 افقی (۲۹۷mm) بر حسب px در ۹۶dpi — مبنای مقیاس فونت پیش‌نمایش. */
const CANVAS_WIDTH_PX = 1123;

const PLACEHOLDERS = ["recipientName", "nationalId", "title", "companyName", "startDate", "endDate", "durationHours", "score", "issueDate", "code"];

const SAMPLE_TEXT: Record<"fa" | "en", Partial<Record<CertificateFieldKey, string>>> = {
  fa: {
    recipientName: "علی رضایی",
    title: "دوره‌ی مدیریت فروش",
    items: "• آیتم اول    • آیتم سوم\n• آیتم دوم    • آیتم چهارم",
    nationalId: "۰۰۱۲۳۴۵۶۷۸",
    companyName: "نام شرکت شما",
    code: "AB12CD34EF",
    issueDate: "۱۴۰۵/۰۷/۰۶",
  },
  en: {
    recipientName: "Ali Rezaei",
    title: "Sales Management Course",
    items: "• Item one    • Item three\n• Item two    • Item four",
    nationalId: "0012345678",
    companyName: "Your Company",
    code: "AB12CD34EF",
    issueDate: "28 Sep 2026",
  },
};

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
  hint,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (dataUrl: string) => void;
  onRemove: () => void;
  hint?: string;
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
      {hint ? <p className="text-[11px] text-muted mb-2">{hint}</p> : null}
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
          <button type="button" onClick={onRemove} className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer">
            حذف تصویر
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CertificateTemplateSettingsModal({
  onClose,
  initialSettings,
  onSaved,
}: {
  onClose: () => void;
  initialSettings: CertificateTemplateSettings;
  onSaved: (settings: CertificateTemplateSettings) => void;
}) {
  const [settings, setSettings] = useState<CertificateTemplateSettings>(initialSettings);
  const [lang, setLang] = useState<"fa" | "en">("fa");
  const [selected, setSelected] = useState<CertificateFieldKey>("recipientName");
  const [previewWidth, setPreviewWidth] = useState(CANVAS_WIDTH_PX);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<CertificateFieldKey | null>(null);

  const fieldsKey = lang === "fa" ? "fieldsFa" : "fieldsEn";
  const fields = settings[fieldsKey];
  const hasBackground = !!settings.backgroundImage;

  // مقیاس زنده‌ی فونت پیش‌نمایش نسبت به عرض واقعی پیش‌نمایش
  useEffect(() => {
    const el = previewRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setPreviewWidth(el.getBoundingClientRect().width || CANVAS_WIDTH_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasBackground]);

  function updateField(key: CertificateFieldKey, patch: Partial<CertificateFieldPosition>) {
    setSettings((prev) => ({ ...prev, [fieldsKey]: { ...prev[fieldsKey], [key]: { ...prev[fieldsKey][key], ...patch } } }));
  }

  function setFieldPosition(key: CertificateFieldKey, xPct: number, yPct: number) {
    updateField(key, { xPct: Math.max(0, Math.min(100, xPct)), yPct: Math.max(0, Math.min(100, yPct)) });
  }

  function handlePointerMove(e: React.MouseEvent<HTMLDivElement>) {
    const key = draggingRef.current;
    if (!key || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    setFieldPosition(key, ((e.clientX - rect.left) / rect.width) * 100, ((e.clientY - rect.top) / rect.height) * 100);
  }

  function handlePointerUp() {
    draggingRef.current = null;
  }

  function numberPatch(raw: string, apply: (n: number | undefined) => Partial<CertificateFieldPosition>) {
    if (raw.trim() === "") return apply(undefined);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? apply(n) : {};
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await updateCertificateTemplateSettings(settings);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره‌ی قالب ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  const bodyKey = lang === "fa" ? "bodyTextFa" : "bodyTextEn";
  const selPos = fields[selected];
  const scale = previewWidth / CANVAS_WIDTH_PX;
  const numInput =
    "w-full text-[12.5px] outline-none bg-white border border-border rounded-lg px-2.5 py-1.5 focus:border-primary";
  const textInput =
    "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";

  return (
    <Modal title="تنظیمات قالب گواهی" onClose={onClose} width="max-w-[900px]">
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted leading-relaxed">
          یک تصویر پس‌زمینه بارگذاری کنید و سپس هر برچسب را روی تصویر بکشید تا محل چاپ آن فیلد روی گواهی مشخص شود. اندازه‌ی
          فونت، عرض و تراز هر فیلد برای هر زبان جداگانه ذخیره می‌شود. اگر تصویری بارگذاری نکنید، طرح استاندارد طلایی سیستم
          استفاده خواهد شد.
        </p>

        <ImageSlot
          label="تصویر پس‌زمینه‌ی گواهی"
          value={settings.backgroundImage}
          onChange={(dataUrl) => setSettings((prev) => ({ ...prev, backgroundImage: dataUrl }))}
          onRemove={() => setSettings((prev) => ({ ...prev, backgroundImage: null }))}
        />

        <div className="flex gap-2">
          {(["fa", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`text-[12px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${lang === l ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}
            >
              {l === "fa" ? "فارسی" : "English"}
            </button>
          ))}
        </div>

        {hasBackground ? (
          <>
            <div
              ref={previewRef}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              className="relative w-full rounded-xl overflow-hidden border border-border select-none"
              style={{ aspectRatio: "297 / 210" }}
              dir={lang === "fa" ? "rtl" : "ltr"}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={settings.backgroundImage!} alt="پس‌زمینه گواهی" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
              {FIELD_KEYS.map((key) => {
                const pos = fields[key];
                const align = pos.align ?? "center";
                const tx = align === "center" ? "-50%" : align === "right" ? "-100%" : "0%";
                const text = isTextKey(key);
                const sample = key === "body" ? settings[bodyKey] : (SAMPLE_TEXT[lang][key] ?? FIELD_LABELS[key]);
                return (
                  <div
                    key={key}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      draggingRef.current = key;
                      setSelected(key);
                    }}
                    className={`absolute cursor-move rounded-md shadow-md px-1.5 py-0.5 ${
                      selected === key ? "ring-2 ring-primary bg-white/85" : "bg-white/60"
                    } ${pos.visible === false ? "opacity-40" : ""} ${text ? "text-ink" : "text-[10.5px] font-bold text-white bg-primary/90"}`}
                    style={{
                      left: `${pos.xPct}%`,
                      top: `${pos.yPct}%`,
                      transform: `translate(${tx}, -50%)`,
                      textAlign: align,
                      width: pos.widthPct ? `${pos.widthPct}%` : undefined,
                      whiteSpace: text ? "pre-wrap" : "nowrap",
                      fontSize: text && pos.fontSizePx ? `${pos.fontSizePx * scale}px` : undefined,
                      lineHeight: text && pos.lineHeightPx ? `${pos.lineHeightPx * scale}px` : undefined,
                    }}
                  >
                    {text ? sample : FIELD_LABELS[key]}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted">
              برچسب‌ها را بکشید و رها کنید؛ روی برچسب کلیک کنید تا اندازه‌ی فونت، عرض و تراز آن را تنظیم کنید. متن پیش‌نمایش با اندازه‌ی فونت
              انتخابی مقیاس می‌شود.
            </p>

            <div className="bg-slate-50 border border-border rounded-xl p-3.5">
              <div className="flex items-center justify-between mb-2.5">
                <div className="text-[12.5px] font-bold">
                  ویژگی‌های «{FIELD_LABELS[selected]}» ({lang === "fa" ? "فارسی" : "English"})
                </div>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value as CertificateFieldKey)}
                  className="text-[12px] bg-white border border-border rounded-lg px-2 py-1"
                >
                  {FIELD_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {FIELD_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 items-end">
                {isTextKey(selected) ? (
                  <label className="text-[11px] font-semibold text-ink-soft">
                    اندازه‌ی فونت (px)
                    <input
                      type="number"
                      min={6}
                      max={120}
                      step={0.5}
                      dir="ltr"
                      value={selPos.fontSizePx ?? ""}
                      onChange={(e) => updateField(selected, numberPatch(e.target.value, (n) => ({ fontSizePx: n })))}
                      className={numInput}
                    />
                  </label>
                ) : null}
                <label className="text-[11px] font-semibold text-ink-soft">
                  عرض (٪ از صفحه)
                  <input
                    type="number"
                    min={1}
                    max={100}
                    dir="ltr"
                    value={selPos.widthPct ?? ""}
                    onChange={(e) => updateField(selected, numberPatch(e.target.value, (n) => ({ widthPct: n })))}
                    className={numInput}
                  />
                </label>
                {selected === "items" || selected === "body" ? (
                  <label className="text-[11px] font-semibold text-ink-soft">
                    فاصله‌ی خطوط (px)
                    <input
                      type="number"
                      min={8}
                      max={200}
                      dir="ltr"
                      value={selPos.lineHeightPx ?? ""}
                      onChange={(e) => updateField(selected, numberPatch(e.target.value, (n) => ({ lineHeightPx: n })))}
                      className={numInput}
                    />
                  </label>
                ) : null}
                {isTextKey(selected) ? (
                  <label className="text-[11px] font-semibold text-ink-soft">
                    تراز
                    <select
                      value={selPos.align ?? "center"}
                      onChange={(e) => updateField(selected, { align: e.target.value as "left" | "center" | "right" })}
                      className={numInput}
                    >
                      <option value="left">چپ</option>
                      <option value="center">وسط</option>
                      <option value="right">راست</option>
                    </select>
                  </label>
                ) : null}
                <label className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-soft pb-1.5">
                  <input
                    type="checkbox"
                    checked={selPos.visible !== false}
                    onChange={(e) => updateField(selected, { visible: e.target.checked })}
                  />
                  چاپ روی گواهی
                </label>
              </div>
            </div>
          </>
        ) : null}

        <div className="bg-slate-50 border border-border rounded-xl p-3.5 flex flex-col gap-3">
          <div className="text-[12.5px] font-bold">متن گواهی — {lang === "fa" ? "فارسی" : "English"}</div>
          <textarea
            value={settings[bodyKey]}
            onChange={(e) => setSettings((prev) => ({ ...prev, [bodyKey]: e.target.value }))}
            rows={5}
            dir={lang === "fa" ? "rtl" : "ltr"}
            className={textInput}
          />
          <div className="text-[11px] text-muted leading-relaxed" dir="ltr" style={{ textAlign: "right" }}>
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="inline-block bg-white border border-border rounded px-1.5 py-0.5 m-0.5">{`{${p}}`}</code>
            ))}
            <div dir="rtl" className="mt-1">
              مقدار خالی چاپ نمی‌شود و نگه‌دارنده‌ی ناشناخته دست‌نخورده می‌ماند. در نسخه‌ی فارسی همه‌ی اعداد و تاریخ‌ها فارسی (شمسی) و در
              نسخه‌ی انگلیسی لاتین (میلادی) چاپ می‌شوند.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-[12px] font-semibold text-ink-soft">
              نام شرکت صادرکننده (فارسی)
              <input
                value={settings.issuerCompanyNameFa}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuerCompanyNameFa: e.target.value }))}
                placeholder="پیش‌فرض: نام سازمان در تنظیمات عمومی"
                className={`${textInput} mt-1`}
              />
            </label>
            <label className="text-[12px] font-semibold text-ink-soft">
              نام شرکت صادرکننده (English)
              <input
                value={settings.issuerCompanyNameEn}
                onChange={(e) => setSettings((prev) => ({ ...prev, issuerCompanyNameEn: e.target.value }))}
                placeholder="Company name in English"
                dir="ltr"
                className={`${textInput} mt-1`}
              />
            </label>
          </div>

          <label className="text-[12px] font-semibold text-ink-soft">
            تعداد ستون‌های آیتم‌ها (حداکثر ۴ ردیف در هر ستون)
            <select
              value={settings.itemsColumns}
              onChange={(e) => setSettings((prev) => ({ ...prev, itemsColumns: Number(e.target.value) === 3 ? 3 : 2 }))}
              className={`${textInput} mt-1`}
            >
              <option value={2}>۲ ستون — حداکثر ۸ آیتم</option>
              <option value={3}>۳ ستون — حداکثر ۱۲ آیتم</option>
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ImageSlot
            label="مهر (اختیاری، جایگزین مهر مرکزی)"
            hint="اگر خالی بماند از مهر مرکزی تنظیمات → عمومی استفاده می‌شود."
            value={settings.stampImage}
            onChange={(dataUrl) => setSettings((prev) => ({ ...prev, stampImage: dataUrl }))}
            onRemove={() => setSettings((prev) => ({ ...prev, stampImage: null }))}
          />
          <ImageSlot
            label="امضا (اختیاری، جایگزین امضای مرکزی)"
            hint="اگر خالی بماند از امضای مرکزی تنظیمات → عمومی استفاده می‌شود."
            value={settings.signatureImage}
            onChange={(dataUrl) => setSettings((prev) => ({ ...prev, signatureImage: dataUrl }))}
            onRemove={() => setSettings((prev) => ({ ...prev, signatureImage: null }))}
          />
        </div>

        {error ? <div className="text-[12px] text-danger">{error}</div> : null}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="px-5 py-2.5 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : "ذخیره‌ی قالب"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
