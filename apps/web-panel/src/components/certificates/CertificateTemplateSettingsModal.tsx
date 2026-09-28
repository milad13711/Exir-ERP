"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import {
  updateCertificateTemplateSettings,
  type CertificateTemplateSettings,
  type CertificateFieldKey,
} from "@/lib/api";

const FIELD_LABELS: Record<CertificateFieldKey, string> = {
  recipientName: "نام گیرنده",
  title: "عنوان گواهی",
  items: "آیتم‌ها / توضیحات",
  code: "کد گواهی",
  issueDate: "تاریخ صدور",
  qr: "QR",
  stamp: "مهر",
  signature: "امضا",
};

const FIELD_KEYS = Object.keys(FIELD_LABELS) as CertificateFieldKey[];

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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<CertificateFieldKey | null>(null);

  const fields = lang === "fa" ? settings.fieldsFa : settings.fieldsEn;

  function setFieldPosition(key: CertificateFieldKey, xPct: number, yPct: number) {
    setSettings((prev) => {
      const fieldsKey = lang === "fa" ? "fieldsFa" : "fieldsEn";
      return {
        ...prev,
        [fieldsKey]: {
          ...prev[fieldsKey],
          [key]: { ...prev[fieldsKey][key], xPct: Math.max(0, Math.min(100, xPct)), yPct: Math.max(0, Math.min(100, yPct)) },
        },
      };
    });
  }

  function handlePointerDown(key: CertificateFieldKey) {
    draggingRef.current = key;
  }

  function handlePointerMove(e: React.MouseEvent<HTMLDivElement>) {
    const key = draggingRef.current;
    if (!key || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    setFieldPosition(key, xPct, yPct);
  }

  function handlePointerUp() {
    draggingRef.current = null;
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

  return (
    <Modal title="تنظیمات قالب گواهی" onClose={onClose} width="max-w-[820px]">
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted leading-relaxed">
          یک تصویر پس‌زمینه بارگذاری کنید و سپس هر برچسب را روی تصویر بکشید تا محل چاپ آن فیلد روی گواهی مشخص شود. این مختصات
          یک‌بار تنظیم می‌شود و از این پس همه‌ی گواهی‌های صادرشده از همین چیدمان استفاده می‌کنند. اگر تصویری بارگذاری نکنید،
          طرح استاندارد طلایی سیستم استفاده خواهد شد.
        </p>

        <ImageSlot
          label="تصویر پس‌زمینه‌ی گواهی"
          value={settings.backgroundImage}
          onChange={(dataUrl) => setSettings((prev) => ({ ...prev, backgroundImage: dataUrl }))}
          onRemove={() => setSettings((prev) => ({ ...prev, backgroundImage: null }))}
        />

        {settings.backgroundImage ? (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setLang("fa")}
                className={`text-[12px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${lang === "fa" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}
              >
                فارسی
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`text-[12px] font-bold px-3 py-1.5 rounded-lg cursor-pointer ${lang === "en" ? "bg-primary text-white" : "bg-slate-100 text-ink-soft"}`}
              >
                English
              </button>
            </div>

            <div
              ref={previewRef}
              onMouseMove={handlePointerMove}
              onMouseUp={handlePointerUp}
              onMouseLeave={handlePointerUp}
              className="relative w-full rounded-xl overflow-hidden border border-border select-none"
              style={{ aspectRatio: "297 / 210" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={settings.backgroundImage} alt="پس‌زمینه گواهی" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
              {FIELD_KEYS.map((key) => {
                const pos = fields[key];
                return (
                  <div
                    key={key}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handlePointerDown(key);
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 text-[10.5px] font-bold text-white bg-primary/90 px-2 py-1 rounded-md cursor-move shadow-md whitespace-nowrap"
                    style={{ left: `${pos.xPct}%`, top: `${pos.yPct}%` }}
                  >
                    {FIELD_LABELS[key]}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-muted">برچسب‌ها را بکشید و روی نقطه‌ی موردنظر رها کنید.</p>
          </>
        ) : null}

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
