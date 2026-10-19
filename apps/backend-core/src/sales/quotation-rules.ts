/** قواعد ویرایش/ابطال پیش‌فاکتور (خالص، بدون پایگاه داده) — null یعنی مجاز. */
export function quotationEditBlock(status: string): string | null {
  if (status === 'CONVERTED') return 'این پیش‌فاکتور به فاکتور تبدیل شده است؛ فاکتور حاصل را ویرایش کنید';
  if (status === 'CANCELLED') return 'پیش‌فاکتور باطل‌شده قابل ویرایش نیست';
  return null;
}

export function quotationVoidBlock(status: string): string | null {
  if (status === 'DRAFT') return 'پیش‌نویس را حذف کنید (ابطال برای پیش‌فاکتور ارسال‌شده است)';
  if (status === 'CONVERTED') return 'این پیش‌فاکتور به فاکتور تبدیل شده است؛ فاکتور حاصل را باطل کنید';
  if (status === 'CANCELLED') return 'این پیش‌فاکتور قبلاً باطل شده است';
  return null;
}
