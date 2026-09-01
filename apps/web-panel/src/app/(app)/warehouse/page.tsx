"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { WarehouseIcon, PlusIcon, SearchIcon, WarningIcon, OrdersIcon, AccountingIcon } from "@/components/icons";
import { formatToman, formatNumber } from "@/lib/persian";
import { fetchProducts, fetchWarehouseSummary, type Product, type WarehouseSummary } from "@/lib/api";
import { NewProductModal } from "@/components/warehouse/NewProductModal";
import { ProductModal } from "@/components/warehouse/ProductModal";
import { WarehousesModal } from "@/components/warehouse/WarehousesModal";
import { TransferStockModal } from "@/components/warehouse/TransferStockModal";
import { CostingMethodModal } from "@/components/warehouse/CostingMethodModal";

export default function WarehousePage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [summary, setSummary] = useState<WarehouseSummary | null>(null);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [openProductId, setOpenProductId] = useState<string | null>(null);
  const [newProductOpen, setNewProductOpen] = useState(false);
  const [warehousesModalOpen, setWarehousesModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [costingModalOpen, setCostingModalOpen] = useState(false);

  function reload() {
    fetchProducts().then(setProducts).catch(() => setProducts([]));
    fetchWarehouseSummary().then(setSummary).catch(() => {});
  }

  useEffect(reload, []);

  const filtered = useMemo(() => {
    if (!products) return [];
    return products.filter((p) => {
      const matchesSearch =
        !search.trim() ||
        p.name.includes(search) ||
        p.sku.toLowerCase().includes(search.toLowerCase()) ||
        (p.category ?? "").includes(search);
      const matchesLowStock = !lowStockOnly || p.isLowStock;
      return matchesSearch && matchesLowStock;
    });
  }, [products, search, lowStockOnly]);

  return (
    <div className="p-5 lg:p-7 max-w-[1240px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">انبارداری و موجودی</h1>
          <p className="text-[13.5px] text-muted mt-1">کنترل موجودی، رسید و حواله، و هشدار کمبود کالا</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setWarehousesModalOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <WarehouseIcon className="w-4 h-4" />
            انبارها
          </button>
          <button
            onClick={() => setTransferModalOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <OrdersIcon className="w-4 h-4" />
            انتقال موجودی
          </button>
          <button
            onClick={() => setCostingModalOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <AccountingIcon className="w-4 h-4" />
            روش بهای تمام‌شده
          </button>
          <button
            onClick={() => setNewProductOpen(true)}
            className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer"
          >
            <PlusIcon className="w-4 h-4" />
            کالای جدید
          </button>
        </div>
      </div>

      {summary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          <KpiCard label="تعداد کالاها" value={summary.totalProducts} unitSuffix="کالا" tone="primary" icon={<WarehouseIcon />} />
          <KpiCard label="ارزش کل موجودی" value={summary.inventoryValue} unitSuffix="تومان" tone="accent" icon={<WarehouseIcon />} />
          <KpiCard
            label="کالاهای رو به اتمام"
            value={summary.lowStockCount}
            unitSuffix="کالا"
            tone="danger"
            icon={<WarningIcon />}
            note={summary.lowStockCount > 0 ? "نیازمند سفارش مجدد" : undefined}
          />
          <KpiCard label="تراکنش‌های این ماه" value={summary.movementsThisMonth} unitSuffix="تراکنش" tone="warning" icon={<WarehouseIcon />} />
        </div>
      ) : null}

      <div className="flex items-center gap-2.5 mt-6 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-[320px]">
          <SearchIcon className="w-4 h-4 text-muted absolute top-1/2 -translate-y-1/2 right-3.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی نام، کد کالا یا دسته..."
            className="w-full text-[13px] outline-none placeholder:text-muted bg-surface border border-border rounded-xl pr-10 pl-3.5 py-2.5 focus:border-primary transition-colors"
          />
        </div>
        <button
          onClick={() => setLowStockOnly((v) => !v)}
          className={clsx(
            "text-[12px] font-bold px-3.5 py-2.5 rounded-xl border cursor-pointer transition-colors",
            lowStockOnly ? "bg-danger-soft text-danger border-danger/30" : "bg-surface border-border text-ink-soft",
          )}
        >
          فقط کالاهای رو به اتمام
        </button>
      </div>

      <Card className="mt-5 p-2">
        {products === null ? (
          <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">کالایی یافت نشد</div>
        ) : (
          filtered.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setOpenProductId(p.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                i < filtered.length - 1 && "border-b border-border",
              )}
            >
              <div className="w-9 h-9 rounded-xl bg-primary-soft text-primary flex items-center justify-center shrink-0">
                <WarehouseIcon className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-bold truncate">{p.name}</div>
                <div className="text-[11.5px] text-muted mt-0.5 flex items-center gap-2 flex-wrap">
                  <span dir="ltr">{p.sku}</span>
                  {p.category ? <span>· {p.category}</span> : null}
                </div>
              </div>
              {p.isLowStock ? <Badge tone="danger">رو به اتمام</Badge> : null}
              <div className="text-[13px] font-extrabold w-[110px] text-left shrink-0">
                {formatNumber(p.stock)} <span className="text-[11px] font-normal text-muted">{p.unit}</span>
              </div>
              <div className="text-[12px] text-muted w-[130px] text-left shrink-0 hidden sm:block">
                {formatToman(p.stock * p.costPrice)}
              </div>
            </button>
          ))
        )}
      </Card>

      {newProductOpen ? (
        <NewProductModal
          onClose={() => setNewProductOpen(false)}
          onCreated={(product) => {
            setProducts((prev) => [product, ...(prev ?? [])]);
            reload();
          }}
        />
      ) : null}

      {openProductId ? (
        <ProductModal productId={openProductId} onClose={() => setOpenProductId(null)} onChanged={reload} />
      ) : null}

      {warehousesModalOpen ? (
        <WarehousesModal onClose={() => setWarehousesModalOpen(false)} onChanged={reload} />
      ) : null}

      {transferModalOpen ? (
        <TransferStockModal onClose={() => setTransferModalOpen(false)} onTransferred={reload} />
      ) : null}

      {costingModalOpen ? <CostingMethodModal onClose={() => setCostingModalOpen(false)} /> : null}
    </div>
  );
}
