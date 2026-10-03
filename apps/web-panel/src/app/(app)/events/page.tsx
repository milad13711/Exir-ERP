"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchInput } from "@/components/ui/SearchInput";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useRequestGuard } from "@/hooks/useRequestGuard";
import Link from "next/link";
import clsx from "clsx";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TicketIcon, PlusIcon, CalendarIcon, BellIcon } from "@/components/icons";
import { formatJalaliDateTime, toPersianDigits } from "@/lib/persian";
import { fetchEvents, fetchEventsSmsSettings, updateEventsSmsSettings, type EventItem, type EventStatus, type EventsSmsSettings } from "@/lib/api";
import { NewEventModal } from "@/components/events/NewEventModal";
import { EventDetailModal } from "@/components/events/EventDetailModal";
import { ModuleHelp } from "@/components/ui/ModuleHelp";
import { SmsTemplatesModal } from "@/components/sms/SmsTemplatesModal";

const STATUS_LABELS: Record<EventStatus, string> = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", CANCELLED: "لغوشده", COMPLETED: "برگزارشده" };
const STATUS_TONES: Record<EventStatus, "neutral" | "success" | "danger" | "primary"> = { DRAFT: "neutral", PUBLISHED: "success", CANCELLED: "danger", COMPLETED: "primary" };

type StatusFilter = "همه" | EventStatus;

export default function EventsPage() {
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("همه");
  const [newOpen, setNewOpen] = useState(false);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [smsSettingsOpen, setSmsSettingsOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);
  const beginRequest = useRequestGuard();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const searching = loadedFor === null || loadedFor !== search.trim();
  function loadList() {
    const isCurrent = beginRequest();
    const requested = debouncedSearch.trim();
    fetchEvents({ q: debouncedSearch.trim() || undefined })
      .then((r) => {
        if (isCurrent()) setEvents(r);
      })
      .catch(() => {
        if (isCurrent()) setEvents((prev) => prev ?? []);
      })
      .finally(() => {
        if (isCurrent()) setLoadedFor(requested);
      });
  }
  const reload = loadList;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadList, [debouncedSearch]);

  const filtered = useMemo(() => {
    if (!events) return [];
    return events.filter((e) => {
      const matchesStatus = statusFilter === "همه" || e.status === statusFilter;
      return matchesStatus;
    });
  }, [events, statusFilter]);

  return (
    <div className="p-5 lg:p-7 max-w-[1100px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="text-xl font-extrabold">رویداد و بلیط‌فروشی</h1>
            <ModuleHelp code="events" />
          </div>
          <p className="text-[13.5px] text-muted mt-1">صفحه‌ی عمومی فروش بلیط، صدور بلیط QR و ثبت حضور</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/events/check-in" className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl">
            ثبت حضور با اسکن
          </Link>
          <button
            onClick={() => setSmsSettingsOpen(true)}
            className="flex items-center gap-1.5 bg-surface border border-border text-ink-soft text-[12.5px] font-bold px-3.5 py-2.5 rounded-xl cursor-pointer"
          >
            <BellIcon className="w-4 h-4" />
            تنظیمات پیامک
          </button>
          <button onClick={() => setNewOpen(true)} className="flex items-center gap-1.5 bg-primary text-white text-[12.5px] font-bold px-4 py-2.5 rounded-xl cursor-pointer">
            <PlusIcon className="w-4 h-4" />
            رویداد جدید
          </button>
        </div>
      </div>

      {smsSettingsOpen ? (
        <SmsTemplatesModal<EventsSmsSettings>
          title="تنظیمات پیامک — رویدادها"
          fetchSettings={fetchEventsSmsSettings}
          updateSettings={updateEventsSmsSettings}
          onClose={() => setSmsSettingsOpen(false)}
          fields={[{ label: "صدور بلیط", key: "ticketIssuedTemplate", placeholders: "{eventTitle} {ticketCode} {link}" }]}
        />
      ) : null}

      <div className="flex items-center gap-3 mt-6 mb-4 flex-wrap">
        <SearchInput className="max-w-[300px] flex-1 min-w-[220px]" value={search} onChange={setSearch} placeholder="جستجوی عنوان رویداد..." loading={searching} />
        <div className="flex items-center gap-2 flex-wrap">
          {(["همه", "DRAFT", "PUBLISHED", "COMPLETED", "CANCELLED"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={clsx(
                "text-[12px] font-semibold px-3.5 py-2 rounded-[10px] border transition-colors",
                statusFilter === s ? "bg-primary text-white border-primary" : "bg-surface border-border text-ink-soft",
              )}
            >
              {s === "همه" ? "همه" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {events === null ? (
        <div className="p-8 text-center text-muted text-sm">در حال بارگذاری...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted text-sm">رویدادی یافت نشد</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {filtered.map((e) => (
            <button key={e.id} onClick={() => setOpenEventId(e.id)} className="text-right cursor-pointer">
              <Card className="p-0 overflow-hidden h-full">
                <div className="h-32 bg-primary-soft flex items-center justify-center overflow-hidden">
                  {e.coverImage ? (
                    <img src={e.coverImage} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <TicketIcon className="w-8 h-8 text-primary" />
                  )}
                </div>
                <div className="p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0 text-[13.5px] font-bold truncate">{e.title}</div>
                    <Badge tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-muted mt-1.5">
                    <CalendarIcon className="w-3.5 h-3.5" />
                    {formatJalaliDateTime(e.startAt)}
                  </div>
                  {e.capacity != null && (
                    <div className="text-[11.5px] text-muted mt-1">
                      {toPersianDigits(e.remainingCapacity ?? e.capacity)} جای خالی از {toPersianDigits(e.capacity)}
                    </div>
                  )}
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {newOpen && <NewEventModal onClose={() => setNewOpen(false)} onCreated={reload} />}
      {openEventId && <EventDetailModal eventId={openEventId} onClose={() => setOpenEventId(null)} onChanged={reload} />}
    </div>
  );
}
