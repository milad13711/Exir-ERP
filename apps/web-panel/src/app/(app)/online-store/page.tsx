"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { StoreIcon, SendIcon, SettingsIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { formatToman, toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import {
  fetchStoreAnalyticsSummary,
  fetchStoreOrders,
  fetchStoreProducts,
  type StoreAnalyticsSummary,
  type StoreOrder,
  type StoreProduct,
} from "@/lib/api";
import { EditListingModal } from "@/components/online-store/EditListingModal";
import { OrderDetailModal, STORE_ORDER_STATUS_LABELS, STORE_ORDER_STATUS_TONES } from "@/components/online-store/OrderDetailModal";

type Tab = "summary" | "orders" | "products";

export default function OnlineStorePage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<StoreAnalyticsSummary | null>(null);
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [openOrder, setOpenOrder] = useState<StoreOrder | null>(null);
  const [editingProduct, setEditingProduct] = useState<StoreProduct | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const { me } = useWorkspace();

  useEffect(() => {
    fetchStoreAnalyticsSummary(7).then(setSummary).catch(() => setSummary(null));
    fetchStoreOrders().then(setOrders).catch(() => setOrders([]));
    fetchStoreProducts().then(setProducts).catch(() => setProducts([]));
  }, []);

  async function copyStoreLink() {
    if (!me) return;
    const url = `${window.location.origin}/shop/${me.tenant.slug}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  const listedCount = (products ?? []).filter((p) => p.isPubliclyListed).length;

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-extrabold">فروشگاه آنلاین</h1>
          <p className="text-[13.5px] text-muted mt-1">نمای عمومی فروشگاه، سفارش‌ها، و تحلیل بازدید و فروش</p>
        </div>
        <button
          onClick={copyStoreLink}
          disabled={!me}
          className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer disabled:opacity-50"
        >
          <SendIcon className="w-4 h-4" />
          {linkCopied ? "لینک کپی شد" : "لینک فروشگاه عمومی"}
        </button>
      </div>

      <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 mt-6 w-fit">
        {([
          ["summary", "خلاصه و تحلیل"],
          ["orders", "سفارش‌ها"],
          ["products", "محصولات عمومی"],
        ] as [Tab, string][]).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={clsx(
              "text-[12px] font-bold px-3.5 py-2 rounded-lg cursor-pointer",
              tab === v ? "bg-white text-primary shadow-sm" : "text-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && (
        <div className="mt-5 flex flex-col gap-5">
          {summary === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <KpiCard label={`بازدید (${toPersianDigits(summary.periodDays)} روز اخیر)`} value={summary.uniqueVisitors} unit="نفر" tone="primary" icon={<StoreIcon className="w-4 h-4" />} />
                <KpiCard label="سفارش ثبت‌شده" value={summary.totalOrders} unit="سفارش" tone="accent" icon={<StoreIcon className="w-4 h-4" />} />
                <KpiCard label="سبد خرید رهاشده" value={summary.abandonedCarts} unit="سبد" tone="warning" icon={<StoreIcon className="w-4 h-4" />} />
                <KpiCard label="فروش (بدون لغوشده‌ها)" value={summary.revenue} unitSuffix="تومان" tone="success" icon={<StoreIcon className="w-4 h-4" />} />
              </div>

              <Card className="p-5">
                <div className="text-[13.5px] font-bold mb-3">وضعیت سفارش‌ها</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {Object.entries(summary.ordersByStatus).length === 0 ? (
                    <div className="text-[12.5px] text-muted">هنوز سفارشی ثبت نشده</div>
                  ) : (
                    Object.entries(summary.ordersByStatus).map(([status, count]) => (
                      <div key={status} className="flex items-center gap-1.5 bg-slate-50 rounded-xl px-3 py-2">
                        <Badge tone={STORE_ORDER_STATUS_TONES[status as keyof typeof STORE_ORDER_STATUS_TONES]}>
                          {STORE_ORDER_STATUS_LABELS[status as keyof typeof STORE_ORDER_STATUS_LABELS]}
                        </Badge>
                        <span className="text-[12.5px] font-bold">{toPersianDigits(count)}</span>
                      </div>
                    ))
                  )}
                </div>
              </Card>

              <Card className="p-5">
                <div className="text-[13.5px] font-bold mb-3">محبوب‌ترین کالاها</div>
                {summary.mostViewedProducts.length === 0 ? (
                  <div className="text-[12.5px] text-muted">هنوز بازدیدی از کالاها ثبت نشده</div>
                ) : (
                  <div className="flex flex-col">
                    {summary.mostViewedProducts.map((p, i) => (
                      <div
                        key={p.productId}
                        className={clsx("flex items-center justify-between gap-3 py-2.5", i < summary.mostViewedProducts.length - 1 && "border-b border-border")}
                      >
                        <span className="text-[12.5px] font-bold">{p.name}</span>
                        <div className="flex items-center gap-3 text-[11.5px] text-muted shrink-0">
                          <span>{toPersianDigits(p.views)} بازدید</span>
                          {p.avgDwellSeconds !== null ? <span>میانگین مکث {toPersianDigits(p.avgDwellSeconds)} ثانیه</span> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      )}

      {tab === "orders" && (
        <Card className="mt-5 p-2">
          {orders === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">هنوز سفارشی ثبت نشده</div>
          ) : (
            orders.map((o, i) => (
              <button
                key={o.id}
                onClick={() => setOpenOrder(o)}
                className={clsx(
                  "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors flex-wrap",
                  i < orders.length - 1 && "border-b border-border",
                )}
              >
                <div className="w-14 text-[12.5px] font-extrabold text-muted shrink-0">#{toPersianDigits(o.orderNo)}</div>
                <div className="flex-1 min-w-[160px]">
                  <div className="text-[13px] font-bold">{o.customerName}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {formatJalaliDateTime(o.createdAt)} · {toPersianDigits(o.lines.length)} قلم
                  </div>
                </div>
                <div className="text-[13px] font-extrabold">{formatToman(o.subtotal)}</div>
                <Badge tone={STORE_ORDER_STATUS_TONES[o.status]}>{STORE_ORDER_STATUS_LABELS[o.status]}</Badge>
              </button>
            ))
          )}
        </Card>
      )}

      {tab === "products" && (
        <div className="mt-5">
          <div className="text-[12.5px] text-muted mb-3">
            {toPersianDigits(listedCount)} از {toPersianDigits((products ?? []).length)} کالا در فروشگاه عمومی نمایش داده می‌شود.
          </div>
          <Card className="p-2">
            {products === null ? (
              <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
            ) : products.length === 0 ? (
              <div className="p-8 text-center text-muted text-sm">هنوز کالایی در انبار ثبت نشده</div>
            ) : (
              products.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setEditingProduct(p)}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-3.5 text-right cursor-pointer hover:bg-slate-50 transition-colors",
                    i < products.length - 1 && "border-b border-border",
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate">{p.name}</div>
                    <div className="mt-1">
                      <Badge tone={p.isPubliclyListed ? "success" : "neutral"}>
                        {p.isPubliclyListed ? "نمایش در فروشگاه" : "پنهان"}
                      </Badge>
                    </div>
                  </div>
                  <div className="text-[12px] text-muted shrink-0">موجود: {toPersianDigits(p.available)}</div>
                  <div className="text-[13px] font-extrabold w-[130px] text-left shrink-0">{formatToman(p.salePrice)}</div>
                  <SettingsIcon className="w-4 h-4 text-muted shrink-0" />
                </button>
              ))
            )}
          </Card>
        </div>
      )}

      {openOrder ? (
        <OrderDetailModal
          order={openOrder}
          onClose={() => setOpenOrder(null)}
          onChanged={(updated) => {
            setOpenOrder(updated);
            setOrders((prev) => (prev ? prev.map((o) => (o.id === updated.id ? updated : o)) : prev));
          }}
        />
      ) : null}

      {editingProduct ? (
        <EditListingModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={(updated) => {
            setProducts((prev) => (prev ? prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)) : prev));
          }}
        />
      ) : null}
    </div>
  );
}
