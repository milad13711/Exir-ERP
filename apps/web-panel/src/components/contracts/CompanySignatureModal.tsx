import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchCompanySignature, saveCompanySignature } from "@/lib/api";

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
    const dataUrl = await readAsDataUrl(file);
    onChange(dataUrl);
  }

  return (
    <div className="bg-slate-50 border border-border rounded-xl p-3.5">
      <div className="text-[12px] font-semibold text-ink-soft mb-2">{label}</div>
      {value ? (
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

export function CompanySignatureModal({ onClose }: { onClose: () => void }) {
  const [signatureImage, setSignatureImage] = useState<string | null | undefined>(undefined);
  const [stampImage, setStampImage] = useState<string | null | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCompanySignature()
      .then((s) => {
        setSignatureImage(s.signatureImage);
        setStampImage(s.stampImage);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveCompanySignature({ signatureImage, stampImage });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="امضا و مهر پیش‌فرض شرکت" onClose={onClose} width="max-w-[440px]">
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted leading-relaxed -mt-1">
          این تصاویر هنگام امضای قرارداد از طرف شرکت به‌عنوان جایگزین امضای دست‌نویس در دسترس خواهند بود.
        </p>
        {!loaded ? (
          <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          <>
            <ImageSlot label="تصویر امضا" value={signatureImage} onChange={setSignatureImage} onRemove={() => setSignatureImage(null)} />
            <ImageSlot label="تصویر مهر" value={stampImage} onChange={setStampImage} onRemove={() => setStampImage(null)} />
          </>
        )}
        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
        <button
          onClick={handleSave}
          disabled={saving || !loaded}
          className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
        >
          {saving ? "در حال ذخیره..." : "ذخیره"}
        </button>
      </div>
    </Modal>
  );
}
