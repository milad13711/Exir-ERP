"use client";

import { useState } from "react";
import { CloseIcon, TrashIcon } from "@/components/icons";
import { formatToman, toPersianDigits } from "@/lib/persian";
import { updateStoreListing, ApiError, type StoreProduct } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function EditListingModal({
  product,
  onClose,
  onSaved,
}: {
  product: StoreProduct;
  onClose: () => void;
  onSaved: (p: StoreProduct) => void;
}) {
  const [isPubliclyListed, setIsPubliclyListed] = useState(product.isPubliclyListed);
  const [publicSlug, setPublicSlug] = useState(product.publicSlug ?? slugify(product.name));
  const [publicDescription, setPublicDescription] = useState(product.publicDescription ?? "");
  const [images, setImages] = useState<string[]>(product.publicImages);
  const [compareAtPrice, setCompareAtPrice] = useState(product.publicCompareAtPrice ? String(product.publicCompareAtPrice) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 6 - images.length);
    if (files.length === 0) return;
    const uris = await Promise.all(files.map(fileToDataUri));
    setImages((prev) => [...prev, ...uris].slice(0, 6));
    e.target.value = "";
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateStoreListing(product.id, {
        isPubliclyListed,
        publicSlug: publicSlug.trim() || undefined,
        publicDescription: publicDescription.trim() || undefined,
        publicImages: images,
        publicCompareAtPrice: compareAtPrice.trim() ? Number(compareAtPrice) : null,
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ذخیره‌سازی با خطا مواجه شد");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-3xl w-full max-w-[520px] max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border sticky top-0 bg-white z-10">
          <h2 className="text-[15px] font-extrabold">نمایش عمومی «{product.name}»</h2>
          <button onClick={onClose} className="text-muted cursor-pointer">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-4">
          <label className="flex items-center gap-2.5 bg-primary-soft rounded-xl p-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isPubliclyListed}
              onChange={(e) => setIsPubliclyListed(e.target.checked)}
              className="w-4 h-4 accent-[var(--color-primary)]"
            />
            <span className="text-[13px] font-bold text-primary">این کالا در فروشگاه آنلاین عمومی نشان داده شود</span>
          </label>

          <div>
            <label className={labelClass}>شناسه‌ی عمومی (در آدرس صفحه‌ی محصول)</label>
            <input
              value={publicSlug}
              onChange={(e) => setPublicSlug(slugify(e.target.value))}
              dir="ltr"
              placeholder="asus-vivobook"
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>توضیح برای مشتری</label>
            <textarea
              value={publicDescription}
              onChange={(e) => setPublicDescription(e.target.value)}
              rows={4}
              placeholder="توضیح جذاب و ساده درباره‌ی این کالا برای مشتری نهایی..."
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>تصاویر ({toPersianDigits(images.length)} از ۶)</label>
            <div className="grid grid-cols-3 gap-2.5">
              {images.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-border group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    className="absolute top-1 left-1 w-6 h-6 rounded-lg bg-white/90 flex items-center justify-center text-danger cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {images.length < 6 && (
                <label className="aspect-square rounded-xl border-2 border-dashed border-border flex items-center justify-center text-[11px] text-muted cursor-pointer hover:border-primary/40">
                  + افزودن
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageUpload} />
                </label>
              )}
            </div>
          </div>

          <div>
            <label className={labelClass}>قیمت قبل از تخفیف (تومان — اختیاری، برای نشان تخفیف)</label>
            <input
              value={compareAtPrice}
              onChange={(e) => setCompareAtPrice(e.target.value.replace(/[^\d]/g, ""))}
              dir="ltr"
              inputMode="numeric"
              placeholder={`باید بیشتر از ${formatToman(product.salePrice)} باشد`}
              className={inputClass}
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-3.5 text-[12px] text-ink-soft flex items-center justify-between">
            <span>موجودی قابل‌فروش</span>
            <span className="font-extrabold">{toPersianDigits(product.available)}</span>
          </div>

          {error ? <div className="text-[12px] text-danger">{error}</div> : null}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-primary text-white text-[13.5px] font-bold cursor-pointer disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : `ذخیره — ${formatToman(product.salePrice)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
