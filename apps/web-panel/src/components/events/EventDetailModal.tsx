"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { PlusIcon, ShareIcon, WhatsAppIcon } from "@/components/icons";
import { formatJalaliDateTime, formatToman, toPersianDigits } from "@/lib/persian";
import { copyToClipboard } from "@/lib/clipboard";
import { useWorkspace } from "@/lib/workspace-context";
import { EventPosterModal } from "./EventPosterModal";
import {
  fetchEvent,
  publishEvent,
  unpublishEvent,
  cancelEvent,
  fetchEventBookings,
  fetchEventTickets,
  createEventTicketType,
  deleteEventTicketType,
  createManualEventBooking,
  type EventItem,
  type EventBooking,
  type EventTicket,
  type EventStatus,
} from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";

const STATUS_LABELS: Record<EventStatus, string> = { DRAFT: "پیش‌نویس", PUBLISHED: "منتشرشده", CANCELLED: "لغوشده", COMPLETED: "برگزارشده" };
const STATUS_TONES: Record<EventStatus, "neutral" | "success" | "danger" | "primary"> = { DRAFT: "neutral", PUBLISHED: "success", CANCELLED: "danger", COMPLETED: "primary" };
const TICKET_STATUS_LABELS: Record<string, string> = { VALID: "معتبر", CHECKED_IN: "حاضر شده", CANCELLED: "باطل" };

function NewTicketTypeForm({ eventId, onCreated }: { eventId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [capacity, setCapacity] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer">
        <PlusIcon className="w-3.5 h-3.5" /> افزودن نوع بلیط
      </button>
    );
  }

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createEventTicketType(eventId, { name: name.trim(), price: Number(price) || 0, capacity: capacity ? Number(capacity) : undefined });
      setName("");
      setPrice("0");
      setCapacity("");
      setOpen(false);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex gap-2 items-center">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="نام" className={inputClass} />
      <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="قیمت" className={inputClass} />
      <input value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="ظرفیت" className={`${inputClass} max-w-[80px]`} />
      <button disabled={saving || !name.trim()} onClick={submit} className="text-[11.5px] font-bold px-3 py-2 rounded-lg bg-primary text-white cursor-pointer disabled:opacity-50 shrink-0">
        ثبت
      </button>
    </div>
  );
}

function ManualBookingForm({ event, onCreated }: { event: EventItem; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [ticketTypeId, setTicketTypeId] = useState(event.ticketTypes[0]?.id ?? "");
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer">
        <PlusIcon className="w-3.5 h-3.5" /> ثبت دستی/حضوری
      </button>
    );
  }

  async function submit() {
    if (!ticketTypeId || !buyerName.trim() || !buyerPhone.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await createManualEventBooking(event.id, {
        buyerName: buyerName.trim(),
        buyerPhone: buyerPhone.trim(),
        items: [{ ticketTypeId, attendees: [{ name: buyerName.trim(), phone: buyerPhone.trim() }] }],
      });
      setBuyerName("");
      setBuyerPhone("");
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ثبت ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-3 flex flex-col gap-2">
      <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)} className={inputClass}>
        {event.ticketTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} — {formatToman(t.price)}
          </option>
        ))}
      </select>
      <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="نام و نام خانوادگی" className={inputClass} />
      <input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value.replace(/[^0-9]/g, ""))} dir="ltr" placeholder="09xxxxxxxxx" className={inputClass} />
      {error && <div className="text-[11.5px] text-danger font-semibold">{error}</div>}
      <div className="flex gap-2">
        <button disabled={saving} onClick={submit} className="flex-1 text-[12px] font-bold py-2 rounded-lg bg-primary text-white cursor-pointer disabled:opacity-50">
          صدور بلیط
        </button>
        <button onClick={() => setOpen(false)} className="text-[12px] font-bold py-2 px-3 rounded-lg bg-slate-100 text-ink-soft cursor-pointer">
          انصراف
        </button>
      </div>
    </div>
  );
}

export function EventDetailModal({ eventId, onClose, onChanged }: { eventId: string; onClose: () => void; onChanged: () => void }) {
  const { me } = useWorkspace();
  const [event, setEvent] = useState<EventItem | null>(null);
  const [bookings, setBookings] = useState<EventBooking[] | null>(null);
  const [tab, setTab] = useState<"info" | "bookings" | "tickets">("info");
  const [tickets, setTickets] = useState<EventTicket[] | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [posterOpen, setPosterOpen] = useState(false);

  function refetch() {
    fetchEvent(eventId).then(setEvent).catch(() => setEvent(null));
    fetchEventBookings(eventId).then(setBookings).catch(() => setBookings([]));
    fetchEventTickets(eventId).then(setTickets).catch(() => setTickets([]));
  }
  useEffect(refetch, [eventId]);

  function reload() {
    refetch();
    onChanged();
  }

  async function handlePublish() {
    await publishEvent(eventId);
    reload();
  }
  async function handleUnpublish() {
    await unpublishEvent(eventId);
    reload();
  }
  async function handleCancel() {
    if (!window.confirm("این رویداد لغو شود؟")) return;
    await cancelEvent(eventId);
    reload();
  }

  if (!event) {
    return (
      <Modal title="در حال بارگذاری..." onClose={onClose} width="max-w-[640px]">
        <div className="p-6 text-center text-muted text-sm">در حال بارگذاری...</div>
      </Modal>
    );
  }

  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/events/${me?.tenant.slug ?? "exir-demo"}/${event.slug}` : "";
  const soldTotal = event.ticketTypes.reduce((sum, t) => sum + (t.sold ?? 0), 0);
  const checkedInCount = (tickets ?? []).filter((t) => t.status === "CHECKED_IN").length;

  return (
    <Modal title={event.title} onClose={onClose} width="max-w-[680px]">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONES[event.status]}>{STATUS_LABELS[event.status]}</Badge>
            <span className="text-[12px] text-muted">
              {toPersianDigits(soldTotal)} بلیط صادرشده · {toPersianDigits(checkedInCount)} نفر حاضر
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {event.status === "DRAFT" && (
              <button onClick={handlePublish} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-success-soft text-success cursor-pointer">
                انتشار
              </button>
            )}
            {event.status === "PUBLISHED" && (
              <button onClick={handleUnpublish} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-warning-soft text-warning cursor-pointer">
                بازگشت به پیش‌نویس
              </button>
            )}
            {(event.status === "DRAFT" || event.status === "PUBLISHED") && (
              <button onClick={handleCancel} className="text-[11px] font-bold px-2.5 py-1.5 rounded-lg bg-danger-soft text-danger cursor-pointer">
                لغو رویداد
              </button>
            )}
          </div>
        </div>

        {event.status === "PUBLISHED" && publicUrl && (
          <div className="flex items-center gap-2 bg-primary-soft rounded-xl p-2.5">
            <input readOnly value={publicUrl} dir="ltr" className="flex-1 bg-transparent text-[11.5px] text-primary outline-none" />
            <button
              onClick={async () => {
                const ok = await copyToClipboard(publicUrl);
                setLinkCopied(ok);
                if (ok) setTimeout(() => setLinkCopied(false), 2000);
              }}
              title="کپی لینک"
              className="w-8 h-8 flex items-center justify-center text-primary cursor-pointer shrink-0"
            >
              <ShareIcon className="w-4 h-4" />
            </button>
            <a href={`https://wa.me/?text=${encodeURIComponent(publicUrl)}`} target="_blank" rel="noreferrer" title="ارسال در واتس‌اپ" className="w-8 h-8 flex items-center justify-center text-[#25D366] shrink-0">
              <WhatsAppIcon className="w-4.5 h-4.5" />
            </a>
            <button onClick={() => setPosterOpen(true)} className="text-[11px] font-bold text-primary cursor-pointer shrink-0">
              انتشار
            </button>
            {linkCopied && <span className="text-[11px] text-success font-semibold shrink-0">کپی شد</span>}
          </div>
        )}

        <div className="flex gap-2">
          {(["info", "bookings", "tickets"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[12px] font-bold px-3.5 py-2 rounded-xl border cursor-pointer ${tab === t ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}
            >
              {t === "info" ? "انواع بلیط" : t === "bookings" ? "رزروها" : "بلیط‌ها و حضور"}
            </button>
          ))}
        </div>

        {tab === "info" && (
          <div className="flex flex-col gap-2.5">
            {event.ticketTypes.map((t) => (
              <div key={t.id} className="flex items-center justify-between border border-border rounded-xl p-3">
                <div>
                  <div className="text-[13px] font-bold">{t.name}</div>
                  <div className="text-[11.5px] text-muted mt-0.5">
                    {formatToman(t.price)} · {toPersianDigits(t.sold ?? 0)} فروخته‌شده{t.capacity != null ? ` از ${toPersianDigits(t.capacity)}` : ""}
                  </div>
                </div>
                {(t.sold ?? 0) === 0 && (
                  <button onClick={() => deleteEventTicketType(t.id).then(reload)} className="text-[11px] font-bold text-danger cursor-pointer">
                    حذف
                  </button>
                )}
              </div>
            ))}
            <NewTicketTypeForm eventId={event.id} onCreated={reload} />
          </div>
        )}

        {tab === "bookings" && (
          <div className="flex flex-col gap-2.5">
            {(bookings ?? []).length === 0 ? (
              <div className="text-[12.5px] text-muted">هنوز رزروی ثبت نشده</div>
            ) : (
              bookings!.map((b) => (
                <div key={b.id} className="border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[13px] font-bold">{b.buyerName}</div>
                    <Badge tone={b.status === "PAID" ? "success" : b.status === "PENDING_PAYMENT" ? "warning" : "neutral"}>
                      {b.status === "PAID" ? "پرداخت‌شده" : b.status === "PENDING_PAYMENT" ? "در انتظار پرداخت" : b.status === "CANCELLED" ? "لغوشده" : "منقضی"}
                    </Badge>
                  </div>
                  <div className="text-[11.5px] text-muted mt-1">
                    {b.buyerPhone} · {b.ticketType.name} · {toPersianDigits(b.quantity)} بلیط · {formatToman(b.totalAmount)}
                  </div>
                  <div className="text-[11px] text-muted mt-1">{formatJalaliDateTime(b.createdAt)}</div>
                </div>
              ))
            )}
            <ManualBookingForm event={event} onCreated={reload} />
          </div>
        )}

        {tab === "tickets" && (
          <div className="flex flex-col gap-2">
            {(tickets ?? []).length === 0 ? (
              <div className="text-[12.5px] text-muted">هنوز بلیطی صادر نشده</div>
            ) : (
              tickets!.map((t) => (
                <div key={t.id} className="flex items-center justify-between border border-border rounded-xl px-3 py-2.5">
                  <div>
                    <div className="text-[12.5px] font-bold">{t.attendeeName}</div>
                    <div className="text-[11px] text-muted mt-0.5">
                      کد {t.ticketCode} · {t.ticketType.name}
                    </div>
                  </div>
                  <Badge tone={t.status === "CHECKED_IN" ? "success" : t.status === "CANCELLED" ? "danger" : "neutral"}>{TICKET_STATUS_LABELS[t.status]}</Badge>
                </div>
              ))
            )}
          </div>
        )}
      </div>
      {posterOpen && <EventPosterModal event={event} onClose={() => setPosterOpen(false)} />}
    </Modal>
  );
}
