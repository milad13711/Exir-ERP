"use client";

import { useState } from "react";
import { safeHref } from "@/lib/safe-url";
import { CheckIcon, TicketIcon, ShareIcon, WhatsAppIcon } from "@/components/icons";
import { formatJalaliDateTime } from "@/lib/persian";
import { copyToClipboard } from "@/lib/clipboard";
import { publicEventTicketQrImageUrl, publicEventTicketPdfUrl, type PublicEventTicket } from "@/lib/api";

const STATUS_LABELS: Record<string, string> = { VALID: "معتبر", CHECKED_IN: "حضور ثبت‌شده", CANCELLED: "باطل‌شده" };

export function TicketViewClient({ tenantSlug, ticket, shareUrl }: { tenantSlug: string; ticket: PublicEventTicket; shareUrl: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: `بلیط ${ticket.event.title}`, url: shareUrl });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div dir="rtl" className="min-h-dvh bg-slate-100 flex items-center justify-center p-5">
      <div className="max-w-[400px] w-full bg-white rounded-[28px] shadow-lg overflow-hidden" style={{ boxShadow: "0 20px 50px -20px rgba(15,23,42,.35)" }}>
        <div className="bg-gradient-to-br from-primary to-primary-dark text-white p-6 text-center relative">
          <TicketIcon className="w-6 h-6 mx-auto mb-2 opacity-90" />
          <div className="text-[16px] font-extrabold">{ticket.event.title}</div>
          <div className="text-[12px] opacity-85 mt-1.5 inline-block bg-white/15 rounded-full px-3 py-1">{ticket.ticketType.name}</div>
        </div>

        {/* دندانه‌های بلیط — حس یک بلیط واقعی */}
        <div className="relative h-4 bg-white">
          <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-slate-100" />
          <div className="absolute -top-2 -left-2 w-4 h-4 rounded-full bg-slate-100" />
          <div className="absolute top-1 left-6 right-6 border-t-2 border-dashed border-border" />
        </div>

        <div className="p-6 pt-3 flex flex-col items-center">
          <div className="p-3 bg-white border border-border rounded-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={publicEventTicketQrImageUrl(tenantSlug, ticket.qrToken)} alt="QR بلیط — برای ورود اسکن شود" className="w-56 h-56" />
          </div>
          <div className="text-[20px] font-extrabold tracking-[4px] mt-4" dir="ltr">
            {ticket.ticketCode}
          </div>
          <div className="text-[11px] text-muted mt-1">این کد را برای ورود همراه داشته باشید</div>

          {ticket.status === "CHECKED_IN" && (
            <div className="flex items-center gap-1.5 text-success text-[12.5px] font-bold mt-3 bg-success-soft rounded-full px-3 py-1.5">
              <CheckIcon className="w-4 h-4" /> حضور شما ثبت شده است
            </div>
          )}
          {ticket.status === "CANCELLED" && <div className="text-danger text-[12.5px] font-bold mt-3 bg-danger-soft rounded-full px-3 py-1.5">این بلیط باطل شده است</div>}

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
                <a href={safeHref(ticket.event.onlineUrl)} target="_blank" rel="noreferrer" className="font-bold text-primary">
                  ورود به جلسه
                </a>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted">وضعیت</span>
              <span className="font-bold">{STATUS_LABELS[ticket.status]}</span>
            </div>
          </div>

          <div className="flex gap-2 w-full mt-5">
            <a
              href={publicEventTicketPdfUrl(tenantSlug, ticket.qrToken)}
              target="_blank"
              rel="noreferrer"
              className="flex-1 py-3 rounded-xl bg-primary text-white text-[13px] font-bold text-center"
            >
              دانلود PDF
            </a>
            <button onClick={share} className="w-12 flex items-center justify-center rounded-xl bg-primary-soft text-primary cursor-pointer">
              <ShareIcon className="w-4.5 h-4.5" />
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareUrl)}`}
              target="_blank"
              rel="noreferrer"
              className="w-12 flex items-center justify-center rounded-xl bg-primary-soft text-[#25D366]"
            >
              <WhatsAppIcon className="w-4.5 h-4.5" />
            </a>
          </div>
          {copied && <div className="text-[11.5px] text-success font-semibold mt-2">لینک کپی شد</div>}
        </div>
      </div>
    </div>
  );
}
