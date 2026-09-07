"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/ui/KpiCard";
import { StoreIcon, SendIcon, SettingsIcon, StarIcon, CheckIcon, CloseIcon } from "@/components/icons";
import { useWorkspace } from "@/lib/workspace-context";
import { formatToman, toPersianDigits, formatJalaliDateTime } from "@/lib/persian";
import {
  fetchStoreAnalyticsSummary,
  fetchStoreOrders,
  fetchStoreProducts,
  fetchStoreReviews,
  updateStoreReviewStatus,
  type StoreAnalyticsSummary,
  type StoreOrder,
  type StoreProduct,
  type StoreReview,
} from "@/lib/api";
import { EditListingModal } from "@/components/online-store/EditListingModal";
import { OrderDetailModal, STORE_ORDER_STATUS_LABELS, STORE_ORDER_STATUS_TONES } from "@/components/online-store/OrderDetailModal";

type Tab = "summary" | "orders" | "products" | "reviews";

export default function OnlineStorePage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [summary, setSummary] = useState<StoreAnalyticsSummary | null>(null);
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [reviews, setReviews] = useState<StoreReview[] | null>(null);
  const [openOrder, setOpenOrder] = useState<StoreOrder | null>(null);
  const [editingProduct, setEditingProduct] = useState<StoreProduct | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const { me } = useWorkspace();

  function reloadReviews() {
    fetchStoreReviews().then(setReviews).catch(() => setReviews([]));
  }

  useEffect(() => {
    fetchStoreAnalyticsSummary(7).then(setSummary).catch(() => setSummary(null));
    fetchStoreOrders().then(setOrders).catch(() => setOrders([]));
    fetchStoreProducts().then(setProducts).catch(() => setProducts([]));
    reloadReviews();
  }, []);

  async function decideReview(id: string, status: "APPROVED" | "REJECTED") {
    const updated = await updateStoreReviewStatus(id, status);
    setReviews((prev) => (prev ? prev.map((r) => (r.id === id ? updated : r)) : prev));
  }

  const pendingReviewCount = (reviews ?? []).filter((r) => r.status === "PENDING").length;

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
          ["reviews", "نظرات مشتریان"],
        ] as [Tab, string][]).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={clsx(
              "text-[12px] font-bold px-3.5 py-2 rounded-lg cursor-pointer flex items-center gap-1.5",
              tab === v ? "bg-white text-primary shadow-sm" : "text-muted",
            )}
          >
            {label}
            {v === "reviews" && pendingReviewCount > 0 ? (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-warning text-white text-[10px] font-extrabold flex items-center justify-center">
                {toPersianDigits(pendingReviewCount)}
              </span>
            ) : null}
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

      {tab === "reviews" && (
        <Card className="mt-5 p-2">
          {reviews === null ? (
            <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
          ) : reviews.length === 0 ? (
            <div className="p-8 text-center text-muted text-sm">هنوز نظری ثبت نشده</div>
          ) : (
            reviews.map((r, i) => (
              <div
                key={r.id}
                className={clsx("flex items-start gap-3 px-4 py-3.5 flex-wrap", i < reviews.length - 1 && "border-b border-border")}
              >
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold">{r.customerName}</span>
                    <span className="text-[11px] text-muted">درباره‌ی {r.product.name}</span>
                  </div>
                  <div dir="ltr" className="flex items-center gap-0.5 text-warning mt-1">
                    {Array.from({ length: 5 }, (_, idx) => (
                      <StarIcon key={idx} className={`w-3.5 h-3.5 ${idx < r.rating ? "fill-current" : "text-border"}`} />
                    ))}
                  </div>
                  {r.comment ? <p className="text-[12.5px] text-ink-soft leading-relaxed mt-1.5">{r.comment}</p> : null}
                  <div className="text-[11px] text-muted mt-1">{formatJalaliDateTime(r.createdAt)}</div>
                </div>
                {r.status === "PENDING" ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => decideReview(r.id, "APPROVED")}
                      className="w-8 h-8 rounded-lg bg-success-soft text-success flex items-center justify-center cursor-pointer"
                      aria-label="تأیید"
                    >
                      <CheckIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => decideReview(r.id, "REJECTED")}
                      className="w-8 h-8 rounded-lg bg-danger-soft text-danger flex items-center justify-center cursor-pointer"
                      aria-label="رد"
                    >
                      <CloseIcon className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <Badge tone={r.status === "APPROVED" ? "success" : "danger"}>
                    {r.status === "APPROVED" ? "تأییدشده" : "ردشده"}
                  </Badge>
                )}
              </div>
            ))
          )}
        </Card>
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
