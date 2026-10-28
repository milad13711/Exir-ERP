/** اعتبارسنجی شبا (mod-97) و کارت (Luhn) — همان الگوریتم backend (accounting/banking/iran-bank-validators.ts)؛ دستی هماهنگ نگه دارید. */
const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

export function normalizeDigits(v: string): string {
  return v.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
}
export function normalizeSheba(v: string): string {
  return normalizeDigits(v).replace(/[\s-]/g, "").toUpperCase();
}
export function isValidSheba(input: string): boolean {
  const s = normalizeSheba(input);
  if (!/^IR\d{24}$/.test(s)) return false;
  const rearranged = `${s.slice(4)}1827${s.slice(2, 4)}`;
  let rem = 0;
  for (const ch of rearranged) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
}
export function normalizeCard(v: string): string {
  return normalizeDigits(v).replace(/[\s-]/g, "");
}
export function isValidCardNumber(input: string): boolean {
  const s = normalizeCard(input);
  if (!/^\d{16}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 16; i += 1) {
    let d = Number(s[15 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
/** نمایش ۴رقم-۴رقم برای کارت. */
export function formatCard(v: string | null): string {
  return v ? v.replace(/(\d{4})(?=\d)/g, "$1 ") : "";
}
