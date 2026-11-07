import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EbookDeliveryService } from './ebook-delivery.service.js';
import { licenceCode, verifyDownload } from './ebook-license.js';
import type { TenantRequestContext } from '../common/request-context.js';

// جای license_stamp.py: همان CLI (issue --name= --phone= --order= --pdf= --epub= --out=) و همان خروجی JSON،
// با Node اجرا می‌شود تا تست به پایتون/PyMuPDF وابسته نباشد. MODE=bad کد غلط چاپ می‌کند (راز ناهمخوان).
const FAKE_STAMPER = `
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const a = Object.fromEntries(process.argv.slice(3).map((x) => x.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const runs = path.join(process.argv[1] + '.runs'); fs.appendFileSync(runs, a.name + '\\n');
const phone = a.phone.replace(/\\D/g, '').replace(/^98/, '0');
const mac = crypto.createHmac('sha256', process.env.FK_LICENSE_SECRET).update(a.order + '|' + phone).digest();
const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0, out = '';
for (const b of mac) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B[(v >>> (bits - 5)) & 31]; bits -= 5; } }
let code = 'FK-' + out.slice(0, 16).match(/.{4}/g).join('-'); if (fs.existsSync(process.argv[1] + '.bad')) code = 'FK-AAAA-AAAA-AAAA-AAAA';
fs.mkdirSync(a.out, { recursive: true });
fs.writeFileSync(path.join(a.out, 'soltan-ghif-' + a.order + '.pdf'), 'PDF for ' + a.name);
fs.writeFileSync(path.join(a.out, 'soltan-ghif-' + a.order + '.epub'), 'EPUB for ' + a.name);
setTimeout(() => console.log(JSON.stringify({ order: a.order, code })), 50);
`;

describe('EbookDeliveryService', () => {
  let dir: string;
  let stamper: string;
  const env = { ...process.env };
  const update = vi.fn(async () => ({}));
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const ctx = { tenantId: 'tenant-1', tenantSlug: 'acme', tenantDb: { bookOrder: { update, updateMany } } } as unknown as TenantRequestContext;
  const order = { id: '3f1c2b4a-0000-4000-8000-000000000001', orderNo: 1024, buyerName: '--out=/etc علی رضایی', buyerPhone: '09121234567' };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fk-ebook-'));
    stamper = join(dir, 'fake-stamper.cjs');
    await writeFile(stamper, FAKE_STAMPER);
    Object.assign(process.env, {
      FK_LICENSE_SECRET: 'test-secret',
      FK_EBOOK_TENANT_SLUG: 'acme',
      FK_EBOOK_DIR: dir,
      FK_EBOOK_PYTHON: process.execPath,
      FK_EBOOK_STAMPER: stamper,
      FK_EBOOK_LINK_TTL_HOURS: '2',
      PUBLIC_API_URL: 'https://api.example.test/api/',
    });
    update.mockClear();
    updateMany.mockClear();
  });

  afterEach(async () => {
    process.env = { ...env };
    await rm(dir, { recursive: true, force: true });
  });

  it('is disabled without a secret or for another tenant (fail-closed)', () => {
    const svc = new EbookDeliveryService();
    expect(svc.isEnabledFor({ tenantSlug: 'other' })).toBe(false);
    delete process.env.FK_LICENSE_SECRET;
    expect(svc.isEnabledFor({ tenantSlug: 'acme' })).toBe(false);
    expect(svc.licenseCodeFor({ tenantSlug: 'acme' }, order)).toBeNull();
    expect(svc.links({ tenantSlug: 'acme' }, order.id)).toBeNull();
  });

  it('builds signed, expiring links for both files', () => {
    const svc = new EbookDeliveryService();
    const now = Date.UTC(2026, 9, 31);
    const links = svc.links({ tenantSlug: 'acme' }, order.id, now)!;
    expect(links.pageUrl).toMatch(/^https:\/\/api\.example\.test\/api\/public\/book\/acme\/ebook\/3f1c2b4a-[^?]+\?e=[0-9a-z]+&s=[\w-]{22}$/);
    expect(links.pdfUrl).toContain(`/ebook/${order.id}/pdf?`);
    expect(links.epubUrl).toContain(`/ebook/${order.id}/epub?`);
    expect(new Date(links.expiresAt).getTime()).toBe(now + 2 * 3600 * 1000);
    const q = new URL(links.pdfUrl).searchParams;
    expect(verifyDownload('test-secret', order.id, q.get('e'), q.get('s'), now)).toBe('ok');
  });

  it('issues once for concurrent requests, stores files privately and marks the order delivered', async () => {
    const svc = new EbookDeliveryService();
    const [a, b] = await Promise.all([svc.ensureIssued(ctx, order), svc.ensureIssued(ctx, order)]);
    expect(a && b).toBe(true);
    expect((await readFile(`${stamper}.runs`, 'utf8')).trim().split('\n')).toEqual([order.buyerName]); // نام با «--» آرگومان argparse نشد
    const pdf = svc.filePath(ctx, order, 'pdf')!;
    expect(pdf).toBe(join(dir, 'issued', 'tenant-1', order.id, 'soltan-ghif-1024.pdf'));
    expect(await readFile(pdf, 'utf8')).toBe(`PDF for ${order.buyerName}`);
    expect(await svc.isIssued(ctx, order)).toBe(true);
    expect(update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: expect.objectContaining({ ebookError: null, licenseCode: licenceCode('test-secret', 1024, '09121234567') }),
    });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: order.id, status: 'PAID' }, data: { status: 'DELIVERED' } });

    // بار دوم فایل‌ها موجودند → پروسه‌ی تازه‌ای اجرا نمی‌شود
    await svc.ensureIssued(ctx, order);
    expect((await readFile(`${stamper}.runs`, 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('records an error and leaves nothing behind when the stamper disagrees on the code', async () => {
    await writeFile(`${stamper}.bad`, '');
    const svc = new EbookDeliveryService();
    expect(await svc.ensureIssued(ctx, order)).toBe(false);
    expect(await svc.isIssued(ctx, order)).toBe(false);
    expect(existsSync(join(dir, 'issued', 'tenant-1', order.id))).toBe(false);
    expect(update).toHaveBeenCalledWith({ where: { id: order.id }, data: { ebookError: expect.stringContaining('licence code mismatch') } });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('records an error when the stamper cannot run', async () => {
    process.env.FK_EBOOK_PYTHON = join(dir, 'no-such-python');
    const svc = new EbookDeliveryService();
    expect(await svc.ensureIssued(ctx, order)).toBe(false);
    expect(update).toHaveBeenCalledWith({ where: { id: order.id }, data: { ebookError: expect.any(String) } });
  });
});
