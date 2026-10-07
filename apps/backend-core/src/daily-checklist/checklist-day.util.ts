import { BadRequestException } from '@nestjs/common';

const DAY_MS = 86_400_000;

/** تاریخ امروز به وقت تهران، به‌صورت نیمه‌شبِ UTC همان تاریخ — هم‌قالب با ستون date چک‌لیست. */
export function todayTehran(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = parts.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** فقط دیروز، امروز و فردا قابل ایجاد و ویرایش‌اند. */
export function assertEditableDay(date: Date, now: Date = new Date()): void {
  const today = todayTehran(now).getTime();
  const diff = Math.round((date.getTime() - today) / DAY_MS);
  if (diff < -1 || diff > 1) {
    throw new BadRequestException('فقط چک‌لیست دیروز، امروز و فردا قابل ایجاد یا ویرایش است');
  }
}

export function buildDailyReportBody(
  userName: string,
  dateFa: string,
  items: Array<{ title: string; description: string | null; done: boolean; carriedOver?: boolean }>,
  files: Array<{ title: string; itemTitle: string; archived?: boolean }> = [],
): string {
  const done = items.filter((i) => i.done);
  const pending = items.filter((i) => !i.done);
  const render = (list: typeof items) =>
    list.length === 0 ? 'موردی نیست' : list.map((i) => `- ${i.title}${i.description ? ` — ${i.description}` : ''}${i.carriedOver ? ' (مانده از قبل)' : ''}`).join('\n');
  const filesBlock =
    files.length === 0
      ? []
      : [
          '',
          `فایل‌های پیوست (${files.length}):`,
          ...files.map((f) => `- ${f.title}${f.itemTitle ? ` (مربوط به: ${f.itemTitle})` : ''}${f.archived === false ? ' — به‌دلیل حجم بایگانی نشد' : ''}`),
        ];
  return [
    `گزارش روزانه‌ی ${userName} — ${dateFa}`,
    '',
    `انجام‌شده (${done.length} از ${items.length}):`,
    render(done),
    '',
    'انجام‌نشده:',
    render(pending),
    ...filesBlock,
  ].join('\n');
}
