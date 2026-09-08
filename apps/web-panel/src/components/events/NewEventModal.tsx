"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateTimeInput } from "@/components/ui/JalaliDateTimeInput";
import { TrashIcon, PlusIcon } from "@/components/icons";
import { createEvent, ApiError } from "@/lib/api";

const inputClass =
  "w-full text-[13px] outline-none placeholder:text-muted bg-slate-50 border border-border rounded-lg px-3 py-2.5 focus:border-primary transition-colors";
const labelClass = "text-[12px] font-semibold text-ink-soft mb-1.5 block";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type TicketTypeRow = { name: string; price: string; capacity: string };

export function NewEventModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [coverImage, setCoverImage] = useState<string | undefined>();
  const [venue, setVenue] = useState("");
  const [isOnline, setIsOnline] = useState(false);
  const [onlineUrl, setOnlineUrl] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [registrationOpensAt, setRegistrationOpensAt] = useState("");
  const [registrationClosesAt, setRegistrationClosesAt] = useState("");
  const [capacity, setCapacity] = useState("");
  const [category, setCategory] = useState("");
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>([{ name: "عادی", price: "0", capacity: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleCoverChange(file: File | null) {
    if (!file) return;
    setCoverImage(await fileToDataUri(file));
  }

  function updateTicketType(index: number, patch: Partial<TicketTypeRow>) {
    setTicketTypes((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function addTicketType() {
    setTicketTypes((rows) => [...rows, { name: "", price: "0", capacity: "" }]);
  }
  function removeTicketType(index: number) {
    setTicketTypes((rows) => rows.filter((_, i) => i !== index));
  }

  const formValid =
    !!title.trim() &&
    !!slug.trim() &&
    !!startAt &&
    !!endAt &&
    (!isOnline || !!onlineUrl.trim()) &&
    ticketTypes.length > 0 &&
    ticketTypes.every((t) => t.name.trim() && t.price !== "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formValid) return;
    setSaving(true);
    setError(null);
    try {
      await createEvent({
        slug: slug.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        coverImage,
        venue: venue.trim() || undefined,
        isOnline,
        onlineUrl: isOnline ? onlineUrl.trim() : undefined,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        registrationOpensAt: registrationOpensAt ? new Date(registrationOpensAt).toISOString() : undefined,
        registrationClosesAt: registrationClosesAt ? new Date(registrationClosesAt).toISOString() : undefined,
        capacity: capacity ? Number(capacity) : undefined,
        category: category.trim() || undefined,
        ticketTypes: ticketTypes.map((t, i) => ({
          name: t.name.trim(),
          price: Number(t.price) || 0,
          capacity: t.capacity ? Number(t.capacity) : undefined,
          sortOrder: i,
        })),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت رویداد ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="رویداد جدید" onClose={onClose} width="max-w-[560px]">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
        <div>
          <label className={labelClass}>تصویر کاور (اختیاری)</label>
          {coverImage ? (
            <div className="relative">
              <img src={coverImage} alt="" className="w-full h-36 object-cover rounded-xl border border-border" />
              <button type="button" onClick={() => setCoverImage(undefined)} className="absolute top-2 left-2 w-7 h-7 rounded-lg bg-white/90 flex items-center justify-center text-danger cursor-pointer">
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="flex items-center justify-center h-24 rounded-xl border border-dashed border-border text-[12px] text-muted cursor-pointer">
              انتخاب تصویر
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleCoverChange(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>

        <div>
          <label className={labelClass}>عنوان رویداد</label>
          <input value={title} onChange={(e) => handleTitleChange(e.target.value)} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>شناسه‌ی عمومی (در لینک صفحه)</label>
          <input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(slugify(e.target.value));
            }}
            dir="ltr"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>توضیحات (اختیاری)</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={inputClass} />
        </div>

        <div>
          <label className={labelClass}>محل برگزاری</label>
          <div className="flex gap-2 mb-2">
            <button type="button" onClick={() => setIsOnline(false)} className={`flex-1 text-[12px] font-bold py-1.5 rounded-lg border cursor-pointer ${!isOnline ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}>
              حضوری
            </button>
            <button type="button" onClick={() => setIsOnline(true)} className={`flex-1 text-[12px] font-bold py-1.5 rounded-lg border cursor-pointer ${isOnline ? "bg-primary text-white border-primary" : "border-border text-ink-soft"}`}>
              آنلاین
            </button>
          </div>
          {isOnline ? (
            <input value={onlineUrl} onChange={(e) => setOnlineUrl(e.target.value)} dir="ltr" placeholder="https://..." className={inputClass} />
          ) : (
            <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="آدرس محل برگزاری" className={inputClass} />
          )}
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>شروع رویداد</label>
            <JalaliDateTimeInput value={startAt} onChange={setStartAt} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>پایان رویداد</label>
            <JalaliDateTimeInput value={endAt} onChange={setEndAt} className={inputClass} />
          </div>
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>شروع ثبت‌نام (اختیاری)</label>
            <JalaliDateTimeInput value={registrationOpensAt} onChange={setRegistrationOpensAt} className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>پایان ثبت‌نام (اختیاری)</label>
            <JalaliDateTimeInput value={registrationClosesAt} onChange={setRegistrationClosesAt} className={inputClass} />
          </div>
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={labelClass}>ظرفیت کل (اختیاری — نامحدود)</label>
            <input value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
          </div>
          <div className="flex-1">
            <label className={labelClass}>دسته‌بندی (اختیاری)</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={labelClass + " mb-0"}>انواع بلیط</label>
            <button type="button" onClick={addTicketType} className="flex items-center gap-1 text-[11.5px] font-bold text-primary cursor-pointer">
              <PlusIcon className="w-3.5 h-3.5" /> افزودن
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {ticketTypes.map((t, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input value={t.name} onChange={(e) => updateTicketType(i, { name: e.target.value })} placeholder="نام (مثلاً عادی)" className={inputClass} />
                <input value={t.price} onChange={(e) => updateTicketType(i, { price: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" placeholder="قیمت (تومان)" className={inputClass} />
                <input value={t.capacity} onChange={(e) => updateTicketType(i, { capacity: e.target.value.replace(/[^0-9]/g, "") })} inputMode="numeric" placeholder="ظرفیت" className={`${inputClass} max-w-[90px]`} />
                {ticketTypes.length > 1 && (
                  <button type="button" onClick={() => removeTicketType(i)} className="text-danger cursor-pointer shrink-0">
                    <TrashIcon className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button type="submit" disabled={saving || !formValid} className="mt-1 py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold disabled:opacity-50">
          {saving ? "در حال ثبت..." : "ثبت رویداد"}
        </button>
      </form>
    </Modal>
  );
}
