const PERSIAN_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];

/** Converts ASCII digits in a string/number to Persian digits. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => PERSIAN_DIGITS[Number(d)]);
}

/** Formats a number with Persian thousand separators ("٬") and Persian digits. */
export function formatNumber(value: number): string {
  const grouped = Math.round(value).toLocaleString("en-US").replace(/,/g, "٬");
  return toPersianDigits(grouped);
}

export function formatToman(value: number): string {
  return `${formatNumber(value)} تومان`;
}
