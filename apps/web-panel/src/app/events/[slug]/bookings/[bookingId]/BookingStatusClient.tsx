"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TicketIcon, CheckIcon } from "@/components/icons";
import { fetchPublicEventBookingStatus, type EventBookingStatus } from "@/lib/api";

export function BookingStatusClient({ tenantSlug, bookingId }: { tenantSlug: string; bookingId: string }) {
  const [status, setStatus] = useState<EventBookingStatus | null>(null);
  const [tickets, setTickets] = useState<Array<{ qrToken: string; ticketCode: string; attendeeName: string }>>([]);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetchPublicEventBookingStatus(tenantSlug, bookingId);
        if (cancelled) return;
        setStatus(res.status);
        setTickets(res.tickets);
        if (res.status === "PENDING_PAYMENT" && tries < 8) {
          timer = setTimeout(() => setTries((n) => n + 1), 2000);
        }
      } catch {
        /* رزرو یافت نشد یا خطای موقت — همچنان صفحه خالی نشان داده می‌شود */
      }
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tenantSlug, bookingId, tries]);

  return (
    <div dir="rtl" className="min-h-dvh bg-white flex items-center justify-center p-6">
      <div className="max-w-[440px] w-full text-center">
        {status === null && <div className="text-muted text-[13px]">در حال بررسی وضعیت رزرو...</div>}

        {status === "PENDING_PAYMENT" && (
          <div className="text-muted text-[13px]">در انتظار تأیید پرداخت... اگر مدتی طول کشید، صفحه را تازه کنید.</div>
        )}

        {status === "PAID" && (
          <>
            <div className="w-14 h-14 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto mb-4">
              <CheckIcon className="w-7 h-7" />
            </div>
            <h1 className="text-lg font-extrabold mb-1">بلیط شما صادر شد</h1>
            <p className="text-[13px] text-muted mb-6">لینک هر بلیط برای شماره‌ی ثبت‌شده هم پیامک شد.</p>
            <div className="flex flex-col gap-2.5">
              {tickets.map((t) => (
                <Link
                  key={t.qrToken}
                  href={`/events/${tenantSlug}/ticket/${t.qrToken}`}
                  className="flex items-center justify-between border border-border rounded-xl px-4 py-3 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2 text-[13.5px] font-bold">
                    <TicketIcon className="w-4 h-4 text-primary" />
                    {t.attendeeName}
                  </span>
                  <span className="text-[12px] text-muted">کد {t.ticketCode}</span>
                </Link>
              ))}
            </div>
          </>
        )}

        {(status === "CANCELLED" || status === "EXPIRED") && (
          <div className="text-danger text-[13.5px] font-bold">این رزرو لغو یا منقضی شده است.</div>
        )}
      </div>
    </div>
  );
}
