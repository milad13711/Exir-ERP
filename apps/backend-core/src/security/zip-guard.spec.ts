import { deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { assertSafeZip, UnsafeArchiveError } from './zip-guard.js';
import { parseExcelBuffer } from '../common/excel.js';

/** یک zip حداقلی با یک ورودی می‌سازد (می‌توان اندازه‌ی اعلامی uncompressed را جعل کرد). */
function craftZip(data: Buffer, claimedUncompressed?: number): Buffer {
  const comp = deflateRawSync(data);
  const name = Buffer.from('a.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(claimedUncompressed ?? data.length, 24); cd.writeUInt16LE(name.length, 28);
  const localAll = Buffer.concat([local, name, comp]);
  const cdAll = Buffer.concat([cd, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdAll.length, 12); eocd.writeUInt32LE(localAll.length, 16);
  return Buffer.concat([localAll, cdAll, eocd]);
}

describe('assertSafeZip', () => {
  it('accepts a real xlsx written by ExcelJS and the import path still parses it', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('S');
    ws.addRow(['نام', 'تلفن']);
    ws.addRow(['علی', '09120000000']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    expect(() => assertSafeZip(buf)).not.toThrow();
    expect(await parseExcelBuffer(buf)).toEqual([{ 'نام': 'علی', 'تلفن': '09120000000' }]);
  });

  it('rejects a high-ratio archive (zip bomb: ~200MB of zeros in a few hundred KB)', () => {
    // 2 MB of zeros deflates to ~2 KB; the central directory claims 200 MB (what a real bomb's headers say)
    const bomb = craftZip(Buffer.alloc(2 * 1024 * 1024), 200 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(() => assertSafeZip(bomb)).toThrow(UnsafeArchiveError);
  });

  it('rejects a header that lies about its uncompressed size', () => {
    expect(() => assertSafeZip(craftZip(Buffer.from('hello'), 500 * 1024 * 1024))).toThrow(UnsafeArchiveError);
  });

  it('rejects non-zip / truncated input', () => {
    expect(() => assertSafeZip(Buffer.from('not a zip at all, definitely'))).toThrow(UnsafeArchiveError);
    expect(() => assertSafeZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))).toThrow(UnsafeArchiveError);
  });

  it('parseExcelBuffer refuses a bomb before touching ExcelJS', async () => {
    await expect(parseExcelBuffer(craftZip(Buffer.alloc(2 * 1024 * 1024), 200 * 1024 * 1024))).rejects.toBeInstanceOf(UnsafeArchiveError);
  });
});
