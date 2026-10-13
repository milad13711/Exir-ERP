import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { JalaliDateInput } from "@/components/ui/JalaliDateInput";
import { formatJalaliDate, toPersianDigits } from "@/lib/persian";
import {
  createTimeBlock,
  deleteTimeBlock,
  fetchAutoBlockPreview,
  fetchTimeBlocks,
  fetchUsers,
  updateBookingBlockPreferences,
  updateTimeBlock,
  type AutoBlockPreviewItem,
  type BookingBlockPreferences,
  type StaffTimeBlock,
  type TenantUser,
  type TimeBlocksOverview,
} from "@/lib/api";

const WEEKDAY_NAMES = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"];
// ترتیب نمایش هفته‌ی فارسی (شنبه تا جمعه)؛ مقدار ذخیره‌شده همان اندیس backend است (0=یکشنبه).
const DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

const PREF_ITEMS: Array<{ key: keyof BookingBlockPreferences; title: string; hint: string }> = [
  { key: "blockFromTasks", title: "وظایف من", hint: "وظیفه‌ی فعال و منتشرشده‌ای که هم زمان شروع و هم موعد دارد و بازه‌اش حداکثر ۱۲ ساعت است، آن ساعت‌ها را از رزرو آنلاین حذف می‌کند. وظیفه‌ی بدون زمان شروع چیزی را مسدود نمی‌کند." },
  { key: "blockFromCalendar", title: "جلسات مشاوره و تقویم", hint: "جلسات مشاوره‌ی برنامه‌ریزی‌شده‌ای که شما مشاور آن‌ها هستید، در بازه‌ی خودشان رزرو نمی‌شوند." },
  { key: "blockFromLeave", title: "مرخصی تأییدشده", hint: "روزهای مرخصیِ تأییدشده به‌صورت تمام‌روز از رزرو آنلاین حذف می‌شوند." },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function minutesToTime(m: number): string {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function dateKeyLabel(key: string): string {
  return formatJalaliDate(new Date(`${key}T12:00:00`));
}
function isoTime(iso: string): string {
  const d = new Date(iso);
  return toPersianDigits(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
}
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Draft = { id: string | null; startDate: string; endDate: string; allDay: boolean; start: string; end: string; weekdays: number[]; reason: string };

function emptyDraft(): Draft {
  const t = todayKey();
  return { id: null, startDate: t, endDate: t, allDay: false, start: "09:00", end: "10:00", weekdays: [], reason: "" };
}

function describeBlock(b: StaffTimeBlock): string {
  const dates = b.startDate === b.endDate ? dateKeyLabel(b.startDate) : `${dateKeyLabel(b.startDate)} تا ${dateKeyLabel(b.endDate)}`;
  const time = b.startMinute == null || b.endMinute == null ? "تمام روز" : `${toPersianDigits(minutesToTime(b.startMinute))} تا ${toPersianDigits(minutesToTime(b.endMinute))}`;
  const days = b.weekdays.length ? ` · فقط ${DISPLAY_ORDER.filter((d) => b.weekdays.includes(d)).map((d) => WEEKDAY_NAMES[d]).join("، ")}` : "";
  return `${dates} · ${time}${days}`;
}

export function TimeBlocksModal({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>(""); // "" = خودم
  const [overview, setOverview] = useState<TimeBlocksOverview | null>(null);
  const [preview, setPreview] = useState<AutoBlockPreviewItem[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (userId: string) => {
    setError(null);
    try {
      const [o, p] = await Promise.all([fetchTimeBlocks(userId || undefined), fetchAutoBlockPreview(userId || undefined)]);
      setOverview(o);
      setPreview(p);
      if (o.canManageOthers) fetchUsers().then((u) => setUsers(u.filter((x) => x.status === "ACTIVE"))).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "دریافت اطلاعات ناموفق بود");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open / provider switch
    void load(targetUserId);
  }, [load, targetUserId]);

  async function togglePref(key: keyof BookingBlockPreferences, value: boolean) {
    if (!overview) return;
    setOverview({ ...overview, preferences: { ...overview.preferences, [key]: value } });
    try {
      await updateBookingBlockPreferences({ [key]: value, userId: targetUserId || undefined });
      setPreview(await fetchAutoBlockPreview(targetUserId || undefined));
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره ناموفق بود");
      void load(targetUserId);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        startDate: draft.startDate,
        endDate: draft.endDate,
        startMinute: draft.allDay ? null : timeToMinutes(draft.start),
        endMinute: draft.allDay ? null : timeToMinutes(draft.end),
        weekdays: draft.weekdays,
        reason: draft.reason.trim() || null,
      };
      if (draft.id) await updateTimeBlock(draft.id, payload);
      else await createTimeBlock({ ...payload, userId: targetUserId || undefined });
      setDraft(null);
      await load(targetUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("این ساعت غیرفعال حذف شود؟")) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTimeBlock(id);
      await load(targetUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "حذف ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  function edit(b: StaffTimeBlock) {
    setDraft({
      id: b.id,
      startDate: b.startDate,
      endDate: b.endDate,
      allDay: b.startMinute == null || b.endMinute == null,
      start: b.startMinute != null ? minutesToTime(b.startMinute) : "09:00",
      end: b.endMinute != null ? minutesToTime(b.endMinute) : "10:00",
      weekdays: b.weekdays,
      reason: b.reason ?? "",
    });
  }

  const inputCls = "text-[12.5px] outline-none bg-white border border-border rounded-lg px-2 py-1.5";

  return (
    <Modal title="ساعت‌های غیرفعال" onClose={onClose} width="max-w-[560px]">
      <div className="flex flex-col gap-5">
        <p className="text-[12.5px] text-muted leading-relaxed -mt-1">
          ساعت‌هایی که در آن‌ها نمی‌خواهید نوبت بگیرید را از رزرو آنلاین و انتخاب وقت داخلی حذف کنید. مشتری فقط می‌بیند که آن ساعت آزاد نیست و دلیل آن را نمی‌بیند.
        </p>

        {overview?.canManageOthers && (
          <label className="flex flex-col gap-1 text-[12.5px] font-semibold">
            کارشناس
            <select value={targetUserId} onChange={(e) => { setDraft(null); setOverview(null); setTargetUserId(e.target.value); }} className={inputCls}>
              <option value="">خودم</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
        )}

        {overview === null && !error ? (
          <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : overview ? (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-extrabold">مسدودسازی خودکار از بخش‌های دیگر</h3>
              <p className="text-[12px] text-muted leading-relaxed">هر مورد را که روشن باشد، ساعت‌های مشغولیِ همان بخش به‌طور خودکار از وقت‌های آزاد کم می‌شود.</p>
              {PREF_ITEMS.map((item) => (
                <label key={item.key} className="flex items-start gap-2.5 bg-slate-50 border border-border rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={overview.preferences[item.key]} onChange={(e) => togglePref(item.key, e.target.checked)} />
                  <span>
                    <span className="block text-[12.5px] font-bold">{item.title}</span>
                    <span className="block text-[11.5px] text-muted leading-relaxed mt-0.5">{item.hint}</span>
                  </span>
                </label>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-extrabold">ساعت‌های غیرفعال دستی</h3>
                {!draft && (
                  <button onClick={() => setDraft(emptyDraft())} className="text-[12px] font-bold text-primary bg-primary-soft px-3 py-1.5 rounded-lg cursor-pointer">
                    افزودن
                  </button>
                )}
              </div>

              {draft && (
                <div className="flex flex-col gap-3 bg-slate-50 border border-border rounded-xl p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-[12px] font-semibold">
                      از تاریخ
                      <JalaliDateInput value={draft.startDate} onChange={(v) => setDraft({ ...draft, startDate: v, endDate: draft.endDate < v ? v : draft.endDate })} />
                    </label>
                    <label className="flex flex-col gap-1 text-[12px] font-semibold">
                      تا تاریخ
                      <JalaliDateInput value={draft.endDate} onChange={(v) => setDraft({ ...draft, endDate: v })} />
                    </label>
                  </div>
                  <label className="flex items-center gap-2 text-[12.5px] font-semibold cursor-pointer">
                    <input type="checkbox" checked={draft.allDay} onChange={(e) => setDraft({ ...draft, allDay: e.target.checked })} />
                    تمام روز
                  </label>
                  {!draft.allDay && (
                    <div className="flex items-center gap-2.5">
                      <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} className={`flex-1 ${inputCls}`} />
                      <span className="text-muted text-[12px]">تا</span>
                      <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} className={`flex-1 ${inputCls}`} />
                    </div>
                  )}
                  <div>
                    <div className="text-[12px] font-semibold mb-1">فقط در این روزهای هفته (اختیاری؛ خالی = همه‌ی روزها)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {DISPLAY_ORDER.map((d) => {
                        const on = draft.weekdays.includes(d);
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDraft({ ...draft, weekdays: on ? draft.weekdays.filter((x) => x !== d) : [...draft.weekdays, d] })}
                            className={`text-[11.5px] font-bold px-2.5 py-1 rounded-lg border cursor-pointer ${on ? "bg-primary text-white border-primary" : "bg-white text-ink-soft border-border"}`}
                          >
                            {WEEKDAY_NAMES[d]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <input value={draft.reason} maxLength={200} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} placeholder="دلیل (اختیاری، فقط برای شما)" className={inputCls} />
                  <div className="flex gap-2">
                    <button onClick={saveDraft} disabled={busy} className="flex-1 py-2 rounded-xl bg-primary text-white text-[12.5px] font-bold cursor-pointer disabled:opacity-50">
                      {busy ? "در حال ذخیره..." : draft.id ? "ذخیره‌ی تغییرات" : "افزودن"}
                    </button>
                    <button onClick={() => setDraft(null)} disabled={busy} className="px-4 py-2 rounded-xl border border-border text-[12.5px] font-bold text-ink-soft cursor-pointer">
                      انصراف
                    </button>
                  </div>
                </div>
              )}

              {overview.blocks.length === 0 && !draft ? (
                <div className="text-[12px] text-muted py-2">هنوز ساعت غیرفعالی ثبت نشده است.</div>
              ) : (
                overview.blocks.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-border rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold">{describeBlock(b)}</div>
                      {b.reason && <div className="text-[11.5px] text-muted truncate">{b.reason}</div>}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => edit(b)} disabled={busy} className="text-[11.5px] font-bold text-primary cursor-pointer">ویرایش</button>
                      <button onClick={() => remove(b.id)} disabled={busy} className="text-[11.5px] font-bold text-danger cursor-pointer">حذف</button>
                    </div>
                  </div>
                ))
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-[13px] font-extrabold">مسدودی‌های خودکار ۱۴ روز آینده</h3>
              {preview === null ? null : preview.length === 0 ? (
                <div className="text-[12px] text-muted py-1">در ۱۴ روز آینده چیزی به‌صورت خودکار مسدود نشده است.</div>
              ) : (
                preview.map((p, i) => (
                  <div key={`${p.startAt}-${i}`} className="bg-slate-50 border border-border rounded-xl px-3 py-2">
                    <div className="text-[12.5px] font-semibold">
                      {formatJalaliDate(p.startAt)} · {p.allDay ? "تمام روز" : `${isoTime(p.startAt)} تا ${isoTime(p.endAt)}`}
                      {p.allDay && new Date(p.endAt).getTime() - new Date(p.startAt).getTime() > 25 * 3_600_000 && ` تا ${formatJalaliDate(new Date(new Date(p.endAt).getTime() - 3_600_000))}`}
                    </div>
                    <div className="text-[11.5px] text-muted">{p.reason}</div>
                  </div>
                ))
              )}
            </section>
          </>
        ) : null}

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}
      </div>
    </Modal>
  );
}
