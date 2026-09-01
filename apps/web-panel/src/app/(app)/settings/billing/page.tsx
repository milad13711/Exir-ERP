"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatToman, formatJalaliDate, toPersianDigits } from "@/lib/persian";
import { fetchSubscription, fetchInvoices, type Subscription, type Invoice } from "@/lib/api";

const invoiceStatusLabel: Record<Invoice["status"], string> = {
  PAID: "پرداخت‌شده",
  PENDING: "در انتظار پرداخت",
  FAILED: "ناموفق",
};
const invoiceStatusTone: Record<Invoice["status"], "success" | "warning" | "danger"> = {
  PAID: "success",
  PENDING: "warning",
  FAILED: "danger",
};

export default function BillingSettingsPage() {
  const [subscription, setSubscription] = useState<Subscription>(null);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  useEffect(() => {
    fetchSubscription().then(setSubscription).catch(() => {});
    fetchInvoices().then(setInvoices).catch(() => setInvoices([]));
  }, []);

  return (
    <div>
      <h1 className="text-xl font-extrabold">اشتراک و صورتحساب</h1>
      <p className="text-[13.5px] text-muted mt-1">وضعیت پلن فعلی، تمدید و تاریخچه‌ی پرداخت‌ها</p>

      <Card className="mt-6 p-6 bg-gradient-to-br from-indigo-800 to-teal-600 border-0 text-white">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[13px] text-white/75">پلن فعلی</div>
            <div className="text-2xl font-extrabold mt-1">
              {subscription?.planName ?? "بدون اشتراک فعال"}
            </div>
            {subscription ? (
              <div className="text-[13px] text-white/85 mt-2">
                {toPersianDigits(subscription.daysLeft)} روز تا پایان اعتبار — تمدید در{" "}
                {formatJalaliDate(subscription.currentPeriodEnd)}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2.5">
            <button className="bg-white text-indigo-800 font-bold text-[13px] px-5 py-2.75 rounded-[11px]">
              تمدید اشتراک
            </button>
            <button className="border border-white/40 text-white font-bold text-[13px] px-5 py-2.75 rounded-[11px]">
              ارتقای پلن
            </button>
          </div>
        </div>
      </Card>

      <div className="mt-7">
        <div className="text-[14.5px] font-bold mb-3">تاریخچه‌ی صورتحساب</div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">شماره فاکتور</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">تاریخ</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">مبلغ</th>
                <th className="text-start text-[11.5px] text-muted font-semibold pt-4 px-4 pb-3">وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {invoices === null ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted text-sm">
                    در حال بارگذاری...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-muted text-sm">
                    هنوز صورتحسابی صادر نشده است
                  </td>
                </tr>
              ) : (
                invoices.map((inv, i) => (
                  <tr key={inv.id} className={i < invoices.length - 1 ? "border-b border-border" : ""}>
                    <td className="p-4 text-[13px] font-semibold" dir="ltr">
                      {inv.id.slice(0, 8)}
                    </td>
                    <td className="p-4 text-[13px] text-muted">{formatJalaliDate(inv.issuedAt)}</td>
                    <td className="p-4 text-[13px] font-semibold">{formatToman(inv.amount)}</td>
                    <td className="p-4">
                      <Badge tone={invoiceStatusTone[inv.status]}>
                        {invoiceStatusLabel[inv.status]}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
