/**
 * خروجی CSV برای گزارش‌ها — UTF-8 با BOM (باز شدن درست فارسی در اکسل) و امن در برابر تزریق فرمول:
 * سلول متنی که با = + - @ یا tab/CR شروع شود با یک نقل‌قول تکی پیشوند می‌شود (اعداد واقعی دست‌نخورده می‌مانند).
 */
export type CsvCell = string | number | null | undefined;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: CsvCell[][]): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
