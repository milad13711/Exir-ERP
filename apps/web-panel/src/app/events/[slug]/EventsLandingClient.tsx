"use client";

import Link from "next/link";
import { CalendarIcon, TicketIcon } from "@/components/icons";
import { formatJalaliDate, formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import { publicEventCoverImageUrl, type PublicEventItem } from "@/lib/api";

function priceRangeLabel(event: PublicEventItem): string {
  const prices = event.ticketTypes.map((t) => t.price);
  if (prices.length === 0) return "";
  const min = Math.min(...prices);
  if (min === 0 && prices.every((p) => p === 0)) return "رایگان";
  return min === 0 ? `از رایگان تا ${formatToman(Math.max(...prices))}` : `از ${formatToman(min)}`;
}

export function EventsLandingClient({ tenantSlug, events }: { tenantSlug: string; events: PublicEventItem[] }) {
  return (
    <div dir="rtl" className="min-h-dvh bg-white">
      <header className="border-b border-border">
        <div className="max-w-[1100px] mx-auto px-5 py-6 flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center text-primary shrink-0">
            <TicketIcon className="w-4.5 h-4.5" />
          </div>
          <div>
            <div className="font-extrabold text-[16px]">رویدادهای پیش رو</div>
            <div className="text-[12px] text-muted">مشاهده جزئیات و رزرو بلیط آنلاین</div>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-5 py-8">
        {events.length === 0 ? (
          <div className="py-20 text-center text-muted text-sm">در حال حاضر رویداد فعالی وجود ندارد</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {events.map((e) => {
              const soldOut = e.remainingCapacity != null && e.remainingCapacity <= 0;

              return (
                <Link
                  key={e.id}
                  href={`/events/${tenantSlug}/${e.slug}`}
                  className="group rounded-2xl border border-border overflow-hidden hover:shadow-lg transition-shadow bg-white"
                >
                  <div className="h-40 bg-primary-soft overflow-hidden relative">
                    {e.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={publicEventCoverImageUrl(tenantSlug, e.slug)}
                        alt={e.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-primary">
                        <TicketIcon className="w-10 h-10" />
                      </div>
                    )}
                    {soldOut && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-white text-[12.5px] font-bold">ظرفیت تکمیل</span>
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="text-[14.5px] font-extrabold line-clamp-2 min-h-[2.6em]">{e.title}</div>
                    <div className="flex items-center gap-1.5 text-[12px] text-muted mt-2">
                      <CalendarIcon className="w-3.5 h-3.5" />
                      {formatJalaliDateTime(e.startAt)}
                    </div>
                    {e.venue && <div className="text-[12px] text-muted mt-1">{e.venue}</div>}
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-[12.5px] font-bold text-primary">{priceRangeLabel(e)}</span>
                      {e.registrationOpensAt ? (
                        <span className="text-[11px] text-warning font-semibold">ثبت‌نام از {formatJalaliDate(e.registrationOpensAt)}</span>
                      ) : e.remainingCapacity != null ? (
                        <span className="text-[11px] text-muted">{toPersianDigits(e.remainingCapacity)} جای خالی</span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
