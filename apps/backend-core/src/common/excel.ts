import ExcelJS from 'exceljs';
import { assertSafeZip, UnsafeArchiveError } from '../security/zip-guard.js';

export { UnsafeArchiveError };
const MAX_IMPORT_ROWS = 50_000;

/**
 * Shared read/write core for every module's bulk Excel import/export —
 * export writes rows keyed by their Persian column header, import reads
 * them back the same way, so a tenant can export, edit in Excel, and
 * re-import without any header-mapping step. Each module owns its own
 * column list and row<->entity mapping; this file only knows spreadsheets,
 * never what a "product" or "contact" is.
 */

export async function buildExcelBuffer(headers: string[], rows: Array<Record<string, string | number | null>>, sheetName = 'Sheet1'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = headers.map((h) => ({ header: h, key: h, width: 22 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Reads the first sheet's rows as plain objects keyed by header text (row 1). Blank rows are skipped. */
export async function parseExcelBuffer(buffer: Buffer): Promise<Array<Record<string, string | number | null>>> {
  assertSafeZip(buffer); // zip-bomb: اندازه‌ی باز‌شده را از فهرست مرکزی می‌سنجد، پیش از decompress
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  if (sheet.rowCount > MAX_IMPORT_ROWS) throw new UnsafeArchiveError('تعداد ردیف‌های فایل بیش از حد مجاز است');

  const headers: string[] = [];
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim();
  });

  const rows: Array<Record<string, string | number | null>> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string | number | null> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (!key) return;
      const value = cell.value;
      const normalized = value === null || value === undefined ? null : typeof value === 'object' && 'result' in value ? (value as { result: unknown }).result : value;
      obj[key] = normalized === null || normalized === undefined ? null : typeof normalized === 'number' ? normalized : String(normalized).trim();
      if (obj[key] !== null && obj[key] !== '') hasValue = true;
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}

export type ImportRowResult = { row: number; status: 'CREATED' | 'UPDATED' | 'SKIPPED'; reason?: string };
export type ImportSummary = { created: number; updated: number; skipped: number; details: ImportRowResult[] };

export function summarize(results: ImportRowResult[]): ImportSummary {
  return {
    created: results.filter((r) => r.status === 'CREATED').length,
    updated: results.filter((r) => r.status === 'UPDATED').length,
    skipped: results.filter((r) => r.status === 'SKIPPED').length,
    details: results,
  };
}
