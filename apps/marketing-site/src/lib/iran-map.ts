import type { ProductCode } from "./api";
import { IRAN_CITY_DATA } from "./iran-provinces";

export { IRAN_MAP_VIEWBOX, IRAN_PROVINCES, IRAN_CITY_DATA } from "./iran-provinces";

/** نام و مختصات شهرها روی نقشه — فرم درخواست نمایندگی فقط از این فهرست انتخاب می‌کند تا هر نماینده‌ی تأییدشده قابل پین‌گذاری باشد. */
export const IRAN_CITIES: Record<string, [number, number]> = Object.fromEntries(
  Object.entries(IRAN_CITY_DATA).map(([name, c]) => [name, [c.x, c.y] as [number, number]]),
);

export const PRODUCT_LABELS: Record<ProductCode, string> = {
  ERP: "اکسیر ERP",
  REAL_ESTATE: "اکسیراملاک",
  SMS_GATEWAY: "اکسیر اس‌ام‌اس",
  OTHER: "سایر",
};

/** رنگ هر محصول از پالت برند؛ علاوه بر رنگ، شکلِ داخل پین هم متفاوت است تا تفکیک فقط به رنگ وابسته نباشد. */
export const PRODUCT_THEME: Record<ProductCode, { accent: string; ink: string; soft: string; shape: "circle" | "diamond" | "square" }> = {
  ERP: { accent: "#006b65", ink: "#ffffff", soft: "#d9e6cb", shape: "circle" },
  REAL_ESTATE: { accent: "#eef08b", ink: "#002d2a", soft: "#f4f6c2", shape: "diamond" },
  SMS_GATEWAY: { accent: "#002d2a", ink: "#ffffff", soft: "#d2d8b9", shape: "square" },
  OTHER: { accent: "#4a6b67", ink: "#ffffff", soft: "#e4e8d3", shape: "circle" },
};
