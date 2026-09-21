/** سرور معمولاً روی UTC است؛ همه‌ی منطق زمان‌بندی نوبت باید به وقت تهران (UTC+3:30، بدون ساعت تابستانی) حساب شود. */
const TEHRAN_OFFSET = '+03:30';
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function tehranParts(date: Date): { dateKey: string; minutes: number; weekday: number } {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: WEEKDAYS.indexOf(p.weekday), // 0=یکشنبه ... 6=شنبه (همان قرارداد StaffAvailabilitySlot)
  };
}

/** dateKey «YYYY-MM-DD» به وقت تهران + دقیقه از نیمه‌شب → لحظه‌ی مطلق. */
export function fromTehran(dateKey: string, minutes: number): Date {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return new Date(`${dateKey}T${hh}:${mm}:00${TEHRAN_OFFSET}`);
}
