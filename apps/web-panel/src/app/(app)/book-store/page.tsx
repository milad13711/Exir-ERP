"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge, type Tone } from "@/components/ui/Badge";
import { DocsIcon } from "@/components/icons";
import { formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import { useWorkspace } from "@/lib/workspace-context";
import {
  fetchBookOrders,
  fetchBookStoreSettings,
  shipBookOrder,
  type BookOrder,
  type BookOrderFormat,
  type BookOrderStatus,
  type BookStoreSettings,
} from "@/lib/api";
import { BookStoreSettingsModal } from "@/components/book-store/BookStoreSettingsModal";

const FORMAT_LABELS: Record<BookOrderFormat, string> = {
  PRINT: "نسخه‌ی چاپی",
  EBOOK: "نسخه‌ی الکترونیکی",
  AUDIO: "نسخه‌ی صوتی",
};

const STATUS_LABELS: Record<BookOrderStatus, string> = {
  PENDING_PAYMENT: "در انتظار پرداخت",
  PAID: "پرداخت‌شده",
  CANCELLED: "لغوشده",
  SHIPPED: "ارسال‌شده",
  DELIVERED: "تحویل‌شده",
};

const STATUS_TONES: Record<BookOrderStatus, Tone> = {
  PENDING_PAYMENT: "warning",
  PAID: "primary",
  CANCELLED: "danger",
  SHIPPED: "success",
  DELIVERED: "success",
};

export default function BookStorePage() {
  const { me } = useWorkspace();
  const isManager = me?.user.membershipRole === "OWNER" || me?.user.membershipRole === "ADMIN";

  const [orders, setOrders] = useState<BookOrder[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<BookStoreSettings | null>(null);
  const [shippingId, setShippingId] = useState<string | null>(null);

  function reload() {
    fetchBookOrders()
      .then(setOrders)
      .catch(() => setOrders([]));
  }

  useEffect(reload, []);

  async function openSettings() {
    const current = await fetchBookStoreSettings();
    setSettings(current);
    setSettingsOpen(true);
  }

  async function handleShip(order: BookOrder) {
    setShippingId(order.id);
    try {
      await shipBookOrder(order.id);
      reload();
    } finally {
      setShippingId(null);
    }
  }

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <DocsIcon className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-extrabold">فروش تک‌محصولی</h1>
          </div>
          <p className="text-[13.5px] text-muted mt-1">سفارش‌های خرید محصول پرچم‌دار — نسخه‌ی چاپی/الکترونیکی/صوتی، تأییدشده با پیامک و درگاه پرداخت</p>
        </div>
        {isManager ? (
          <button
            onClick={openSettings}
            className="text-[12.5px] font-bold text-ink-soft bg-slate-100 px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            تنظیمات قیمت و انبار
          </button>
        ) : null}
      </div>

      <Card className="mt-6 p-0 overflow-hidden">
        {orders === null ? (
          <div className="p-10 text-center text-[13px] text-muted">در حال بارگذاری...</div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-muted">هنوز سفارشی ثبت نشده است</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[11.5px] text-muted border-b border-border">
                  <th className="text-right font-semibold px-4 py-2.5">شماره سفارش</th>
                  <th className="text-right font-semibold px-4 py-2.5">خریدار</th>
                  <th className="text-right font-semibold px-4 py-2.5">نسخه</th>
                  <th className="text-right font-semibold px-4 py-2.5">مبلغ</th>
                  <th className="text-right font-semibold px-4 py-2.5">وضعیت</th>
                  <th className="text-right font-semibold px-4 py-2.5">تاریخ ثبت</th>
                  <th className="text-right font-semibold px-4 py-2.5">عملیات</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5 font-bold" dir="ltr">
                      #{toPersianDigits(o.orderNo)}
                    </td>
                    <td className="px-4 py-2.5">
                      {o.buyerName}
                      <div className="text-[11px] text-muted" dir="ltr">
                        {toPersianDigits(o.buyerPhone)}
                      </div>
                      {o.format === "PRINT" && o.address ? (
                        <div className="text-[11px] text-muted mt-0.5">
                          {o.address}
                          {o.postalCode ? ` — کد پستی ${toPersianDigits(o.postalCode)}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">{FORMAT_LABELS[o.format]}</td>
                    <td className="px-4 py-2.5" dir="ltr">
                      {formatToman(o.unitPrice)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONES[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-muted">{formatJalaliDateTime(o.createdAt)}</td>
                    <td className="px-4 py-2.5">
                      {o.format === "PRINT" && o.status === "PAID" ? (
                        <button
                          onClick={() => handleShip(o)}
                          disabled={shippingId === o.id}
                          className="text-[11px] font-bold text-success bg-success-soft px-2.5 py-1.5 rounded-lg cursor-pointer disabled:opacity-50"
                        >
                          {shippingId === o.id ? "..." : "علامت‌گذاری ارسال‌شده"}
                        </button>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {settingsOpen && settings ? (
        <BookStoreSettingsModal
          initialSettings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(saved) => setSettings(saved)}
        />
      ) : null}
    </div>
  );
}
