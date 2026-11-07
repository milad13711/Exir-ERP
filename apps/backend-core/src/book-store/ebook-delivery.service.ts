import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TenantRequestContext } from '../common/request-context.js';
import { publicRef } from '../common/tenant-public-key.js';
import { licenceCode, signDownload } from './ebook-license.js';

/**
 * تحویل خودکار نسخه‌ی الکترونیک «سلطان قیف» — برای هر سفارش EBOOK پرداخت‌شده یک
 * نسخه‌ی اختصاصی مهرخورده (PDF + EPUB، «DRM اجتماعی») با ابزار پایتون
 * license_stamp.py ساخته می‌شود؛ ابزار در یک پروسه‌ی جدا اجرا می‌شود چون
 * شکل‌دهی درست متن فارسی در PDF را PyMuPDF (insert_htmlbox) انجام می‌دهد.
 *
 * فایل‌های اصلی و نسخه‌های صادرشده فقط روی دیسک خصوصی سرور (FK_EBOOK_DIR، یک
 * volume که هیچ‌جا سرو استاتیک نمی‌شود) هستند و تنها راه رسیدن به آن‌ها لینک
 * امضاشده‌ی منقضی‌شونده است. env‌ها در docs/ops/funnelking-ebook.md.
 */

export type EbookFileKind = 'pdf' | 'epub';

export interface EbookOrderRef {
  id: string;
  orderNo: number;
  buyerName: string;
  buyerPhone: string;
}

interface EbookConfig {
  secret: string;
  python: string;
  stamper: string;
  masterPdf: string;
  masterEpub: string;
  issuedDir: string;
  linkTtlSeconds: number;
}

const MAX_PARALLEL = 2;
const STAMP_TIMEOUT_MS = 3 * 60_000;

@Injectable()
export class EbookDeliveryService {
  private readonly logger = new Logger('EbookDeliveryService');
  private readonly inflight = new Map<string, Promise<boolean>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  /** env هر بار خوانده می‌شود (نه یک‌بار در سازنده) تا تست‌ها و تغییر env بدون ری‌استارت کار کنند. */
  private config(): EbookConfig | null {
    const secret = process.env.FK_LICENSE_SECRET?.trim();
    if (!secret) return null;
    const dir = process.env.FK_EBOOK_DIR?.trim() || '/app/ebook';
    const masterDir = process.env.FK_EBOOK_MASTER_DIR?.trim() || join(dir, 'master');
    const ttlHours = Number(process.env.FK_EBOOK_LINK_TTL_HOURS);
    return {
      secret,
      python: process.env.FK_EBOOK_PYTHON?.trim() || 'python3',
      stamper: process.env.FK_EBOOK_STAMPER?.trim() || join(dir, 'tool', 'license_stamp.py'),
      masterPdf: join(masterDir, 'soltan-ghif-master.pdf'),
      masterEpub: join(masterDir, 'soltan-ghif-master.epub'),
      issuedDir: process.env.FK_EBOOK_ISSUED_DIR?.trim() || join(dir, 'issued'),
      linkTtlSeconds: Math.round((Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 72) * 3600),
    };
  }

  /**
   * تحویل خودکار فقط برای تننتی که صاحب کتاب است (FK_EBOOK_TENANT_SLUG، slug واقعی یا
   * کلید عمومی t…) — ماژول book-store در کاتالوگ قابل‌نصب است و نباید کتاب را به
   * خریداران تننت دیگری تحویل دهد. نبودِ env = غیرفعال (fail-closed).
   */
  isEnabledFor(ctx: Pick<TenantRequestContext, 'tenantSlug'>): boolean {
    if (!this.config()) return false;
    const allowed = (process.env.FK_EBOOK_TENANT_SLUG ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return allowed.includes(ctx.tenantSlug) || allowed.includes(publicRef(ctx.tenantSlug));
  }

  /** راز امضا — فقط وقتی تحویل برای این تننت فعال است. */
  secretFor(ctx: Pick<TenantRequestContext, 'tenantSlug'>): string | null {
    return this.isEnabledFor(ctx) ? this.config()!.secret : null;
  }

  licenseCodeFor(ctx: Pick<TenantRequestContext, 'tenantSlug'>, order: Pick<EbookOrderRef, 'orderNo' | 'buyerPhone'>): string | null {
    const secret = this.secretFor(ctx);
    return secret ? licenceCode(secret, order.orderNo, order.buyerPhone) : null;
  }

  /** آدرس صفحه‌ی دریافت و دو فایل، با یک توکن امضاشده‌ی مشترک. */
  links(ctx: Pick<TenantRequestContext, 'tenantSlug'>, orderId: string, now = Date.now()) {
    const cfg = this.config();
    if (!cfg || !this.isEnabledFor(ctx)) return null;
    const apiUrl = (process.env.PUBLIC_API_URL ?? 'http://localhost:3001/api').replace(/\/$/, '');
    const { e, s } = signDownload(cfg.secret, orderId, cfg.linkTtlSeconds, now);
    const base = `${apiUrl}/public/book/${publicRef(ctx.tenantSlug)}/ebook/${orderId}`;
    const q = `?e=${e}&s=${s}`;
    return {
      pageUrl: base + q,
      pdfUrl: `${base}/pdf${q}`,
      epubUrl: `${base}/epub${q}`,
      expiresAt: new Date(parseInt(e, 36) * 1000).toISOString(),
    };
  }

  private orderDir(cfg: EbookConfig, tenantId: string, orderId: string): string {
    return join(cfg.issuedDir, tenantId, orderId);
  }

  filePath(ctx: Pick<TenantRequestContext, 'tenantId'>, order: Pick<EbookOrderRef, 'id' | 'orderNo'>, kind: EbookFileKind): string | null {
    const cfg = this.config();
    if (!cfg) return null;
    return join(this.orderDir(cfg, ctx.tenantId, order.id), `soltan-ghif-${order.orderNo}.${kind}`);
  }

  async isIssued(ctx: Pick<TenantRequestContext, 'tenantId'>, order: Pick<EbookOrderRef, 'id' | 'orderNo'>): Promise<boolean> {
    const pdf = this.filePath(ctx, order, 'pdf');
    const epub = this.filePath(ctx, order, 'epub');
    if (!pdf || !epub) return false;
    try {
      await Promise.all([access(pdf), access(epub)]);
      return true;
    } catch {
      return false;
    }
  }

  isIssuing(ctx: Pick<TenantRequestContext, 'tenantId'>, orderId: string): boolean {
    return this.inflight.has(`${ctx.tenantId}:${orderId}`);
  }

  /**
   * نسخه‌ی اختصاصی را (اگر هنوز نیست) می‌سازد؛ درخواست‌های هم‌زمان برای یک سفارش
   * یک پروسه را به اشتراک می‌گذارند و در کل حداکثر MAX_PARALLEL پروسه هم‌زمان اجرا
   * می‌شود (هر نسخه ~۳۰ ثانیه CPU). هیچ‌وقت throw نمی‌کند — خطا روی سفارش ثبت می‌شود.
   */
  ensureIssued(ctx: TenantRequestContext, order: EbookOrderRef): Promise<boolean> {
    const key = `${ctx.tenantId}:${order.id}`;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const job = this.issueOnce(ctx, order).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  private async issueOnce(ctx: TenantRequestContext, order: EbookOrderRef): Promise<boolean> {
    if (await this.isIssued(ctx, order)) return true;
    const cfg = this.config();
    if (!cfg || !this.isEnabledFor(ctx)) return false;

    await this.acquire();
    const finalDir = this.orderDir(cfg, ctx.tenantId, order.id);
    const tmpDir = `${finalDir}.tmp-${process.pid}-${Date.now()}`;
    try {
      await mkdir(tmpDir, { recursive: true });
      const stdout = await this.runStamper(cfg, order, tmpDir);
      const record = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { code?: string };
      const expected = licenceCode(cfg.secret, order.orderNo, order.buyerPhone);
      // راز سرور و رازی که ابزار پایتون دیده باید یکی باشند؛ وگرنه کد چاپ‌شده روی فایل قابل‌تأیید نیست
      if (record.code !== expected) throw new Error(`licence code mismatch (stamper=${record.code ?? '-'})`);
      await rm(finalDir, { recursive: true, force: true });
      await rename(tmpDir, finalDir);
      await ctx.tenantDb.bookOrder.update({
        where: { id: order.id },
        data: { ebookIssuedAt: new Date(), ebookError: null, licenseCode: expected },
      });
      await ctx.tenantDb.bookOrder.updateMany({ where: { id: order.id, status: 'PAID' }, data: { status: 'DELIVERED' } });
      return true;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      this.logger.error(`ebook stamping failed for order #${order.orderNo} (tenant ${ctx.tenantId}): ${message}`);
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      await ctx.tenantDb.bookOrder.update({ where: { id: order.id }, data: { ebookError: message } }).catch(() => undefined);
      return false;
    } finally {
      this.release();
    }
  }

  private runStamper(cfg: EbookConfig, order: EbookOrderRef, outDir: string): Promise<string> {
    // فرم --opt=value تا نامی که با «-» شروع شود به‌عنوان گزینه‌ی argparse خوانده نشود؛ بدون shell.
    const args = [
      cfg.stamper,
      'issue',
      `--name=${order.buyerName.trim()}`,
      `--phone=${order.buyerPhone}`,
      `--order=${order.orderNo}`,
      `--pdf=${cfg.masterPdf}`,
      `--epub=${cfg.masterEpub}`,
      `--out=${outDir}`,
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      FK_LICENSE_SECRET: cfg.secret,
    };
    if (process.env.FK_FONT_DIR) env.FK_FONT_DIR = process.env.FK_FONT_DIR;
    return new Promise((resolve, reject) => {
      execFile(cfg.python, args, { env, timeout: STAMP_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`${err.message.split('\n')[0]} ${String(stderr).trim().split('\n').slice(-3).join(' | ')}`.trim()));
        else resolve(String(stdout));
      });
    });
  }

  private acquire(): Promise<void> {
    if (this.running < MAX_PARALLEL) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(() => { this.running++; resolve(); }));
  }

  private release() {
    this.running--;
    this.waiting.shift()?.();
  }
}
