import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatNumber, formatJalaliDate, formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import {
  fetchProduct,
  createStockMovement,
  updateProduct,
  deleteProduct,
  fetchWarehouses,
  fetchCurrencies,
  type ProductDetail,
  type StockMovementType,
  type Warehouse,
  type Currency,
} from "@/lib/api";
import { MOVEMENT_TYPE_LABELS, MOVEMENT_TYPE_TONES } from "./warehouse-shared";

const inputClass =
  "text-[12px] outline-none placeholder:text-muted bg-surface border border-border rounded-lg px-2.5 py-2 focus:border-primary transition-colors";

export function ProductModal({
  productId,
  onClose,
  onChanged,
}: {
  productId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [type, setType] = useState<StockMovementType>("RECEIPT");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editCostPrice, setEditCostPrice] = useState("");
  const [editSalePrice, setEditSalePrice] = useState("");
  const [editProfitMarginPercent, setEditProfitMarginPercent] = useState("");
  const [editReorderPoint, setEditReorderPoint] = useState("");
  const [editCurrencyId, setEditCurrencyId] = useState("");
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function load() {
    fetchProduct(productId).then(setProduct);
  }

  useEffect(load, [productId]);
  useEffect(() => {
    fetchWarehouses().then((list) => {
      setWarehouses(list);
      setWarehouseId((prev) => prev || list.find((w) => w.isDefault)?.id || list[0]?.id || "");
    });
    fetchCurrencies().then((list) => setCurrencies(list.filter((c) => c.isActive))).catch(() => setCurrencies([]));
  }, []);

  const editSelectedCurrency = currencies.find((c) => c.id === editCurrencyId);

  function startEdit() {
    if (!product) return;
    setEditName(product.name);
    setEditCategory(product.category ?? "");
    setEditCurrencyId(product.currencyId ?? "");
    setEditCostPrice(product.currencyId ? (product.costPriceFx ?? "0") : String(product.costPrice));
    setEditSalePrice(product.currencyId ? (product.salePriceFx ?? "0") : String(product.salePrice));
    setEditProfitMarginPercent(product.profitMarginPercent ?? "");
    setEditReorderPoint(String(product.reorderPoint));
    setEditing(true);
  }

  async function saveEdit() {
    if (!editName.trim()) return;
    setSavingEdit(true);
    try {
      await updateProduct(productId, {
        name: editName.trim(),
        category: editCategory.trim() || undefined,
        costPrice: !editCurrencyId ? Number(editCostPrice) || 0 : undefined,
        salePrice: !editCurrencyId ? Number(editSalePrice) || 0 : undefined,
        reorderPoint: Number(editReorderPoint) || 0,
        currencyId: editCurrencyId || "",
        costPriceFx: editCurrencyId ? Number(editCostPrice) || 0 : undefined,
        salePriceFx: editCurrencyId ? Number(editSalePrice) || 0 : undefined,
        profitMarginPercent: !editCurrencyId && editProfitMarginPercent ? Number(editProfitMarginPercent) : undefined,
      });
      setEditing(false);
      load();
      onChanged();
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDeactivate() {
    if (!window.confirm("این کالا غیرفعال شود؟ از فهرست کالاها حذف می‌شود ولی تاریخچه‌ی تراکنش‌هایش باقی می‌ماند.")) return;
    setDeleting(true);
    try {
      await deleteProduct(productId);
      onChanged();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!quantity || Number(quantity) === 0 || !warehouseId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createStockMovement({
        productId,
        warehouseId,
        type,
        quantity: type === "ADJUSTMENT" ? Number(quantity) : Math.abs(Number(quantity)),
        unitCost: type === "RECEIPT" && unitCost ? Number(unitCost) : undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      setQuantity("");
      setUnitCost("");
      setReference("");
      setNote("");
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="کالا" onClose={onClose} width="max-w-[600px]">
      {!product ? (
        <div className="py-10 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-extrabold">{product.name}</div>
              <div className="text-[12px] text-muted mt-1" dir="ltr">
                {product.sku}
              </div>
              {product.category ? (
                <Badge tone="neutral" className="mt-2">
                  {product.category}
                </Badge>
              ) : null}
            </div>
            <div className="flex items-start gap-3 shrink-0">
              <div className="text-left">
                <div className="text-[11px] text-muted">موجودی فعلی</div>
                <div className={`text-xl font-extrabold ${product.isLowStock ? "text-danger" : "text-primary"}`}>
                  {formatNumber(product.stock)} <span className="text-[12px] font-normal">{product.unit}</span>
                </div>
                {product.isLowStock ? (
                  <div className="text-[11px] text-danger font-semibold mt-0.5">کمتر از نقطه سفارش</div>
                ) : null}
              </div>
              {!editing ? (
                <button
                  type="button"
                  onClick={startEdit}
                  className="text-[11.5px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  ویرایش
                </button>
              ) : null}
            </div>
          </div>

          {editing ? (
            <div className="flex flex-col gap-2.5 bg-slate-50 border border-border rounded-xl p-3.5">
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="نام کالا"
                className={inputClass}
              />
              <input
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                placeholder="دسته‌بندی (اختیاری)"
                className={inputClass}
              />
              {currencies.length > 0 ? (
                <select value={editCurrencyId} onChange={(e) => setEditCurrencyId(e.target.value)} className={inputClass}>
                  <option value="">قیمت‌گذاری تومانی</option>
                  {currencies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <input
                  value={editCostPrice}
                  onChange={(e) => setEditCostPrice(e.target.value.replace(editCurrencyId ? /[^0-9.]/g : /[^0-9]/g, ""))}
                  placeholder={editCurrencyId ? `بهای تمام‌شده (${editSelectedCurrency?.code})` : "بهای تمام‌شده"}
                  className={inputClass}
                  dir="ltr"
                  inputMode="decimal"
                />
                <input
                  value={editSalePrice}
                  onChange={(e) => setEditSalePrice(e.target.value.replace(editCurrencyId ? /[^0-9.]/g : /[^0-9]/g, ""))}
                  placeholder={editCurrencyId ? `قیمت فروش (${editSelectedCurrency?.code})` : "قیمت فروش"}
                  className={inputClass}
                  dir="ltr"
                  inputMode="decimal"
                />
                <input
                  value={editReorderPoint}
                  onChange={(e) => setEditReorderPoint(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="نقطه سفارش"
                  className={inputClass}
                  dir="ltr"
                  inputMode="numeric"
                />
              </div>
              {!editCurrencyId ? (
                <div>
                  <input
                    value={editProfitMarginPercent}
                    onChange={(e) => setEditProfitMarginPercent(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="درصد سود (اختیاری — مثلاً ۳۰)"
                    className={`${inputClass} w-full`}
                    dir="ltr"
                    inputMode="decimal"
                  />
                  <div className="text-[10.5px] text-muted mt-1">
                    با ذخیره‌ی این فیلد، قیمت فروش از «بهای تمام‌شده × (۱ + درصد سود ÷ ۱۰۰)» بازمحاسبه می‌شود و کالا به
                    حالت خودکار (AUTO) برمی‌گردد — حتی اگر قبلاً قیمت فروش را دستی ویرایش کرده باشید.
                  </div>
                </div>
              ) : null}
              {editCurrencyId && editSelectedCurrency && Number(editSalePrice) > 0 ? (
                <div className="text-[11px] text-muted">
                  معادل تومانی فعلی قیمت فروش:{" "}
                  {Math.round(Number(editSalePrice) * Number(editSelectedCurrency.rate)).toLocaleString("en-US")} تومان
                </div>
              ) : null}
              <div className="flex items-center gap-2 justify-between">
                <button
                  type="button"
                  onClick={handleDeactivate}
                  disabled={deleting}
                  className="text-[11.5px] font-bold text-danger bg-danger-soft px-3 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                >
                  {deleting ? "در حال حذف..." : "غیرفعال کردن کالا"}
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="text-[11.5px] font-bold text-ink-soft bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={saveEdit}
                    disabled={savingEdit || !editName.trim()}
                    className="text-[11.5px] font-bold text-white bg-primary px-3.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {savingEdit ? "در حال ذخیره..." : "ذخیره"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 bg-slate-50 border border-border rounded-xl p-3.5">
              <div>
                <div className="text-[11px] text-muted">بهای تمام‌شده</div>
                <div className="text-[13px] font-bold mt-0.5">{formatToman(product.costPrice)}</div>
                {product.currency && product.costPriceFx != null ? (
                  <div className="text-[10.5px] text-muted mt-0.5" dir="ltr">
                    {product.costPriceFx} {product.currency.code}
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-[11px] text-muted flex items-center gap-1.5">
                  قیمت فروش
                  <Badge tone={product.salePriceSource === "MANUAL" ? "warning" : "neutral"} className="text-[9.5px] px-1.5 py-0">
                    {product.salePriceSource === "MANUAL" ? "دستی" : "خودکار"}
                  </Badge>
                </div>
                <div className="text-[13px] font-bold mt-0.5">{formatToman(product.salePrice)}</div>
                {product.currency && product.salePriceFx != null ? (
                  <div className="text-[10.5px] text-muted mt-0.5" dir="ltr">
                    {product.salePriceFx} {product.currency.code}
                  </div>
                ) : null}
                {product.salePriceUpdatedAt ? (
                  <div className="text-[10.5px] text-muted mt-0.5">
                    آخرین به‌روزرسانی: {formatJalaliDateTime(product.salePriceUpdatedAt)}
                  </div>
                ) : null}
              </div>
              <div>
                <div className="text-[11px] text-muted">نقطه سفارش</div>
                <div className="text-[13px] font-bold mt-0.5">
                  {product.reorderPoint > 0 ? `${formatNumber(product.reorderPoint)} ${product.unit}` : "غیرفعال"}
                </div>
              </div>
            </div>
          )}

          {product.stockByWarehouse.length > 0 ? (
            <div>
              <div className="text-[12px] text-muted mb-2">موجودی به تفکیک انبار</div>
              <div className="flex flex-wrap gap-2">
                {product.stockByWarehouse.map((w) => (
                  <div
                    key={w.warehouseId}
                    className="flex items-center gap-2 bg-slate-50 border border-border rounded-lg px-3 py-1.5"
                  >
                    <span className="text-[12px] text-ink-soft">{w.warehouseName}</span>
                    <span className="text-[12.5px] font-extrabold" dir="ltr">
                      {toPersianDigits(w.quantity)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <div className="text-[12px] text-muted mb-2">تاریخچه تراکنش‌ها</div>
            {product.movements.length === 0 ? (
              <div className="text-[12.5px] text-muted text-center py-6 bg-slate-50 rounded-xl border border-border">
                هنوز تراکنشی برای این کالا ثبت نشده است
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto">
                {product.movements.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 bg-slate-50 border border-border rounded-xl px-3.5 py-2.5"
                  >
                    <Badge tone={MOVEMENT_TYPE_TONES[m.type]}>{MOVEMENT_TYPE_LABELS[m.type]}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] text-ink-soft truncate">
                        {m.note ?? m.reference ?? "—"}
                      </div>
                      <div className="text-[11px] text-muted mt-0.5">
                        {formatJalaliDate(m.createdAt)} · {m.warehouse?.name ?? "—"} · {m.createdBy?.name ?? "—"}
                      </div>
                    </div>
                    <div
                      className={`text-[13px] font-extrabold shrink-0 ${m.quantityDelta > 0 ? "text-success" : "text-danger"}`}
                      dir="ltr"
                    >
                      {m.quantityDelta > 0 ? "+" : ""}
                      {toPersianDigits(m.quantityDelta)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 border-t border-border pt-4">
            <div className="text-[12px] text-muted">ثبت تراکنش جدید</div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as StockMovementType)}
                className={inputClass}
              >
                <option value="RECEIPT">رسید ورودی</option>
                <option value="ISSUE">حواله خروجی</option>
                <option value="ADJUSTMENT">اصلاح موجودی</option>
              </select>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={inputClass}
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(/(?!^-)[^0-9]/g, ""))}
                placeholder={type === "ADJUSTMENT" ? "مقدار (±)" : "مقدار"}
                className={`${inputClass} w-24`}
                dir="ltr"
                inputMode="numeric"
              />
              {type === "RECEIPT" ? (
                <input
                  value={unitCost}
                  onChange={(e) => setUnitCost(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="بهای واحد"
                  className={`${inputClass} w-28`}
                  dir="ltr"
                  inputMode="numeric"
                />
              ) : null}
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="شماره سند (اختیاری)"
                className={`${inputClass} w-32`}
              />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="توضیحات"
                className={`${inputClass} flex-1 min-w-[120px]`}
              />
              <button
                type="submit"
                disabled={submitting || !quantity || Number(quantity) === 0}
                className="text-[12.5px] font-bold text-white bg-primary px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
              >
                ثبت
              </button>
            </div>
            {error ? <div className="text-[12px] text-danger">{error}</div> : null}
          </form>
        </div>
      )}
    </Modal>
  );
}
