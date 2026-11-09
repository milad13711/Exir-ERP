import type { ProductCode } from "./api";
import { IRAN_CITY_DATA } from "./iran-provinces";

export { IRAN_MAP_VIEWBOX, IRAN_PROVINCES, IRAN_CITY_DATA } from "./iran-provinces";

/** نام و مختصات شهرها روی نقشه — فرم درخواست نمایندگی فقط از این فهرست انتخاب می‌کند تا هر نماینده‌ی تأییدشده قابل پین‌گذاری باشد. */
export const IRAN_CITIES: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(IRAN_CITY_DATA).map(([name, c]) => [name, [c.x, c.y] as [number, number]]),
);

export const PRODUCT_LABELS: Record<string, string> = {
  ERP: "اکسیر ERP",
  REAL_ESTATE: "اکسیراملاک",
  SMS_GATEWAY: "اکسیر اس‌ام‌اس",
  OTHER: "سایر",
};

/** رنگ هر محصول از پالت برند؛ علاوه بر رنگ، شکلِ داخل پین هم متفاوت است تا تفکیک فقط به رنگ وابسته نباشد. */
export type ProductTheme = { accent: string; ink: string; soft: string; shape: "circle" | "diamond" | "square" };
export const PRODUCT_THEME: Record<string, ProductTheme> = {
  ERP: { accent: "#006b65", ink: "#ffffff", soft: "#d9e6cb", shape: "circle" },
  REAL_ESTATE: { accent: "#eef08b", ink: "#002d2a", soft: "#f4f6c2", shape: "diamond" },
  SMS_GATEWAY: { accent: "#002d2a", ink: "#ffffff", soft: "#d2d8b9", shape: "square" },
  OTHER: { accent: "#4a6b67", ink: "#ffffff", soft: "#e4e8d3", shape: "circle" },
};

/** پالت محصولات تازه‌ی ماژول نمایندگی (کد ناشناخته) — بر اساس ترتیب محصول. */
const EXTRA_THEMES: ProductTheme[] = [
  { accent: "#006b65", ink: "#ffffff", soft: "#d9e6cb", shape: "circle" },
  { accent: "#eef08b", ink: "#002d2a", soft: "#f4f6c2", shape: "diamond" },
  { accent: "#002d2a", ink: "#ffffff", soft: "#d2d8b9", shape: "square" },
  { accent: "#d0a767", ink: "#002d2a", soft: "#f3e8d2", shape: "circle" },
  { accent: "#29574a", ink: "#ffffff", soft: "#d6e3dc", shape: "diamond" },
];
export function productTheme(code: ProductCode | null | undefined, order: string[] = []): ProductTheme {
  if (!code) return PRODUCT_THEME.OTHER;
  if (PRODUCT_THEME[code]) return PRODUCT_THEME[code];
  const i = order.indexOf(code);
  return i >= 0 ? EXTRA_THEMES[i % EXTRA_THEMES.length] : PRODUCT_THEME.OTHER;
}
export function productLabel(code: ProductCode | null | undefined, products: Array<{ code: string; name: string }> = []): string {
  if (!code) return "";
  return products.find((p) => p.code === code)?.name ?? PRODUCT_LABELS[code] ?? code;
}
