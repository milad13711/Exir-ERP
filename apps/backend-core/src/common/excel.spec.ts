import { describe, expect, it } from 'vitest';
import { buildExcelBuffer, parseExcelBuffer, summarize } from './excel.js';

describe('buildExcelBuffer / parseExcelBuffer round-trip', () => {
  it('reads back exactly what was written, keyed by header', async () => {
    const headers = ['نام', 'قیمت', 'کد'];
    const rows = [
      { نام: 'کالای یک', قیمت: 1000, کد: 'A1' },
      { نام: 'کالای دو', قیمت: 2500, کد: 'A2' },
    ];
    const buffer = await buildExcelBuffer(headers, rows);
    const parsed = await parseExcelBuffer(buffer);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ نام: 'کالای یک', قیمت: 1000, کد: 'A1' });
    expect(parsed[1]).toEqual({ نام: 'کالای دو', قیمت: 2500, کد: 'A2' });
  });

  it('skips a fully blank row', async () => {
    const buffer = await buildExcelBuffer(['نام'], [{ نام: 'الف' }, { نام: null }, { نام: 'ب' }]);
    const parsed = await parseExcelBuffer(buffer);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((r) => r['نام'])).toEqual(['الف', 'ب']);
  });

  it('returns an empty array for an empty workbook', async () => {
    const buffer = await buildExcelBuffer(['نام'], []);
    const parsed = await parseExcelBuffer(buffer);
    expect(parsed).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts each status and keeps the row-level detail', () => {
    const summary = summarize([
      { row: 2, status: 'CREATED' },
      { row: 3, status: 'UPDATED' },
      { row: 4, status: 'SKIPPED', reason: 'کد تکراری' },
      { row: 5, status: 'CREATED' },
    ]);
    expect(summary).toEqual({
      created: 2,
      updated: 1,
      skipped: 1,
      details: [
        { row: 2, status: 'CREATED' },
        { row: 3, status: 'UPDATED' },
        { row: 4, status: 'SKIPPED', reason: 'کد تکراری' },
        { row: 5, status: 'CREATED' },
      ],
    });
  });

  it('returns all-zero counts for no results', () => {
    expect(summarize([])).toEqual({ created: 0, updated: 0, skipped: 0, details: [] });
  });
});
