import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchMyAvailability, replaceMyAvailability, type StaffAvailabilitySlot } from "@/lib/api";

const WEEKDAY_NAMES = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"];

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

type DayRow = { enabled: boolean; start: string; end: string };

export function StaffAvailabilityModal({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState<DayRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMyAvailability()
      .then((slots: StaffAvailabilitySlot[]) => {
        const rows: DayRow[] = WEEKDAY_NAMES.map((_, weekday) => {
          const slot = slots.find((s) => s.weekday === weekday);
          return slot
            ? { enabled: true, start: minutesToTime(slot.startMinute), end: minutesToTime(slot.endMinute) }
            : { enabled: false, start: "09:00", end: "17:00" };
        });
        setDays(rows);
      })
      .catch(() => setDays(WEEKDAY_NAMES.map(() => ({ enabled: false, start: "09:00", end: "17:00" }))));
  }, []);

  function updateDay(weekday: number, patch: Partial<DayRow>) {
    setDays((prev) => prev?.map((d, i) => (i === weekday ? { ...d, ...patch } : d)) ?? prev);
  }

  async function handleSave() {
    if (!days) return;
    setSaving(true);
    setError(null);
    try {
      const slots = days
        .map((d, weekday) => ({ ...d, weekday }))
        .filter((d) => d.enabled)
        .map((d) => ({ weekday: d.weekday, startMinute: timeToMinutes(d.start), endMinute: timeToMinutes(d.end) }));
      await replaceMyAvailability(slots);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="وقت‌های آزاد من" onClose={onClose} width="max-w-[480px]">
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-muted leading-relaxed -mt-1">
          فقط روزهایی که وقت آزاد دارید را فعال کنید. اگر هیچ روزی مشخص نکنید، مثل قبل همیشه در دسترس در نظر گرفته می‌شوید — این محدودیت فقط روی رزرو آنلاین اثر دارد.
        </p>

        {days === null ? (
          <div className="py-8 text-center text-muted text-sm">در حال بارگذاری...</div>
        ) : (
          <div className="flex flex-col gap-2">
            {WEEKDAY_NAMES.map((name, weekday) => {
              const d = days[weekday];
              return (
                <div key={weekday} className="flex items-center gap-2.5 bg-slate-50 border border-border rounded-xl px-3 py-2.5">
                  <label className="flex items-center gap-2 text-[12.5px] font-semibold w-[90px] shrink-0 cursor-pointer">
                    <input type="checkbox" checked={d.enabled} onChange={(e) => updateDay(weekday, { enabled: e.target.checked })} />
                    {name}
                  </label>
                  <input
                    type="time"
                    value={d.start}
                    disabled={!d.enabled}
                    onChange={(e) => updateDay(weekday, { start: e.target.value })}
                    className="flex-1 text-[12.5px] outline-none bg-white border border-border rounded-lg px-2 py-1.5 disabled:opacity-40"
                  />
                  <span className="text-muted text-[12px]">تا</span>
                  <input
                    type="time"
                    value={d.end}
                    disabled={!d.enabled}
                    onChange={(e) => updateDay(weekday, { end: e.target.value })}
                    className="flex-1 text-[12.5px] outline-none bg-white border border-border rounded-lg px-2 py-1.5 disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="text-[12.5px] text-danger font-semibold">{error}</div>}

        <button
          onClick={handleSave}
          disabled={saving || days === null}
          className="py-2.5 rounded-xl bg-primary text-white text-[13px] font-bold cursor-pointer disabled:opacity-50"
        >
          {saving ? "در حال ذخیره..." : "ذخیره"}
        </button>
      </div>
    </Modal>
  );
}
