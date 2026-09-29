"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchProducts, updateBookStoreSettings, type BookStoreSettings, type Product } from "@/lib/api";

export function BookStoreSettingsModal({
  initialSettings,
  onClose,
  onSaved,
}: {
  initialSettings: BookStoreSettings;
  onClose: () => void;
  onSaved: (settings: BookStoreSettings) => void;
}) {
  const [printPrice, setPrintPrice] = useState(String(initialSettings.printPriceToman));
  const [ebookPrice, setEbookPrice] = useState(String(initialSettings.ebookPriceToman));
  const [audioPrice, setAudioPrice] = useState(String(initialSettings.audioPriceToman));
  const [printProductId, setPrintProductId] = useState(initialSettings.printProductId ?? "");
  const [products, setProducts] = useState<Product[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  async function handleSave() {
    setError(null);
    const printPriceToman = Number(printPrice);
    const ebookPriceToman = Number(ebookPrice);
    const audioPriceToman = Number(audioPrice);
    if (![printPriceToman, ebookPriceToman, audioPriceToman].every((v) => Number.isFinite(v) && v > 0)) {
      setError("قیمت هر سه نسخه باید عددی مثبت باشد");
      return;
    }
    setSaving(true);
    try {
      const saved = await updateBookStoreSettings({
        printPriceToman,
        ebookPriceToman,
        audioPriceToman,
        printProductId: printProductId || null,
      });
      onSaved(saved);
      onClose();
    } catch {
      setError("ذخیره‌ی تنظیمات ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="تنظیمات فروش تک‌محصولی" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-[12.5px] font-bold text-ink-soft mb-1.5 block">قیمت نسخه‌ی چاپی (تومان)</label>
          <input
            type="number"
            min={1}
            value={printPrice}
            onChange={(e) => setPrintPrice(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div>
          <label className="text-[12.5px] font-bold text-ink-soft mb-1.5 block">قیمت نسخه‌ی الکترونیکی (تومان)</label>
          <input
            type="number"
            min={1}
            value={ebookPrice}
            onChange={(e) => setEbookPrice(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div>
          <label className="text-[12.5px] font-bold text-ink-soft mb-1.5 block">قیمت نسخه‌ی صوتی (تومان)</label>
          <input
            type="number"
            min={1}
            value={audioPrice}
            onChange={(e) => setAudioPrice(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <div>
          <label className="text-[12.5px] font-bold text-ink-soft mb-1.5 block">کالای انبار متناظر با نسخه‌ی چاپی</label>
          <select
            value={printProductId}
            onChange={(e) => setPrintProductId(e.target.value)}
            className="w-full text-[13px] outline-none bg-slate-50 border border-border rounded-xl px-3.5 py-2.5 focus:border-primary transition-colors"
          >
            <option value="">— بدون اتصال به انبار (موجودی کسر نمی‌شود) —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
          <p className="text-[11.5px] text-muted mt-1.5">
            وقتی متصل باشد، با هر «ارسال» سفارش نسخه‌ی چاپی، یک واحد از موجودی این کالا در انبار کسر می‌شود.
          </p>
        </div>

        {error ? <div className="text-[12.5px] text-danger">{error}</div> : null}

        <div className="flex items-center gap-2 justify-end mt-1">
          <button onClick={onClose} className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-4 py-2.5 rounded-xl cursor-pointer">
            انصراف
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-[12.5px] font-bold text-white bg-primary px-4 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
          >
            {saving ? "در حال ذخیره..." : "ذخیره"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
