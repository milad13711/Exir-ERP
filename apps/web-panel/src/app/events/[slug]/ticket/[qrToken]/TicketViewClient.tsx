"use client";

import { CheckIcon, TicketIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { publicEventTicketQrImageUrl, type PublicEventTicket } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = { VALID: "معتبر", CHECKED_IN: "حضور ثبت‌شده", CANCELLED: "باطل‌شده" };

export function TicketViewClient({ tenantSlug, ticket }: { tenantSlug: string; ticket: PublicEventTicket }) {
  const shareUrl = typeof window !== "undefined" ? window.location.href : "";

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `بلیط ${ticket.event.title}`, url: shareUrl });
        return;
      } catch {
        /* کاربر انصراف داد */
      }
    }
    await navigator.clipboard.writeText(shareUrl);
    alert("لینک بلیط کپی شد");
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-50 flex items-center justify-center p-5">
      <div className="max-w-[400px] w-full bg-white rounded-3xl border border-border overflow-hidden shadow-sm">
        <div className="bg-primary text-white p-5 text-center">
          <TicketIcon className="w-6 h-6 mx-auto mb-2" />
          <div className="text-[15px] font-extrabold">{ticket.event.title}</div>
          <div className="text-[12px] opacity-80 mt-1">{ticket.ticketType.name}</div>
        </div>

        <div className="p-6 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={publicEventTicketQrImageUrl(tenantSlug, ticket.qrToken)} alt="QR بلیط" className="w-52 h-52 rounded-xl border border-border" />
          <div className="text-[18px] font-extrabold tracking-[3px] mt-4" dir="ltr">
            {ticket.ticketCode}
          </div>

          {ticket.status === "CHECKED_IN" && (
            <div className="flex items-center gap-1.5 text-success text-[12.5px] font-bold mt-2">
              <CheckIcon className="w-4 h-4" /> حضور شما ثبت شده است
            </div>
          )}
          {ticket.status === "CANCELLED" && <div className="text-danger text-[12.5px] font-bold mt-2">این بلیط باطل شده است</div>}

          <div className="w-full border-t border-border mt-5 pt-4 flex flex-col gap-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-muted">شرکت‌کننده</span>
              <span className="font-bold">{ticket.attendeeName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">زمان رویداد</span>
              <span className="font-bold">{formatJalaliDateTime(ticket.event.startAt)}</span>
            </div>
            {ticket.event.venue && (
              <div className="flex justify-between">
                <span className="text-muted">مکان</span>
                <span className="font-bold">{ticket.event.venue}</span>
              </div>
            )}
            {ticket.event.isOnline && ticket.event.onlineUrl && (
              <div className="flex justify-between">
                <span className="text-muted">لینک آنلاین</span>
                <a href={ticket.event.onlineUrl} target="_blank" rel="noreferrer" className="font-bold text-primary">
                  ورود به جلسه
                </a>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">وضعیت</span>
              <span className="font-bold">{STATUS_LABELS[ticket.status]}</span>
            </div>
          </div>

          <button onClick={share} className="w-full mt-5 py-3 rounded-xl bg-primary-soft text-primary text-[13px] font-bold cursor-pointer">
            اشتراک‌گذاری بلیط
          </button>
        </div>
      </div>
    </div>
  );
}
