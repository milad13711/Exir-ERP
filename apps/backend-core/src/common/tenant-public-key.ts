import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';

/** شناسه‌ی عمومی تننت: «t» + ۱۱ هگز. slugهای واقعی هرگز با این الگو یکی نیستند مگر تصادفاً. */
export const PUBLIC_KEY_PATTERN = /^t[0-9a-f]{11}$/;

const keyBySlug = new Map<string, string>();
const slugByKey = new Map<string, string>();

function remember(slug: string, publicKey: string) {
  keyBySlug.set(slug, publicKey);
  slugByKey.set(publicKey, slug);
}

/**
 * برای ساخت لینک عمومی: شناسه‌ی هش‌شده‌ی تننت. اگر هنوز در کش نیامده باشد (لحظه‌ی بوت)، به slug برمی‌گردد
 * تا لینک خراب نشود — slug هم همچنان پذیرفته می‌شود.
 */
export function publicRef(slug: string): string {
  return keyBySlug.get(slug) ?? slug;
}

/**
 * کش دوطرفه‌ی slug↔publicKey + میدلور که هر بخش از مسیر درخواست را که شبیه publicKey باشد، پیش از
 * رسیدن به کنترلرها به slug واقعی برمی‌گرداند. به‌این ترتیب همه‌ی endpointهای عمومی (که :slug می‌گیرند)
 * بدون تغییر تک‌تک‌شان با لینک هش‌شده هم کار می‌کنند.
 */
@Injectable()
export class TenantPublicKeyService implements OnModuleInit {
  private readonly logger = new Logger('TenantPublicKeyService');

  constructor(private readonly controlDb: ControlPrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
    setInterval(() => void this.refresh(), 60_000).unref();
  }

  async refresh(): Promise<void> {
    try {
      const rows = await this.controlDb.tenant.findMany({ select: { slug: true, publicKey: true } });
      for (const r of rows) remember(r.slug, r.publicKey);
    } catch (err) {
      this.logger.warn(`public key cache refresh failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  async slugFor(key: string): Promise<string | null> {
    const cached = slugByKey.get(key);
    if (cached) return cached;
    const row = await this.controlDb.tenant.findUnique({ where: { publicKey: key }, select: { slug: true, publicKey: true } });
    if (!row) return null;
    remember(row.slug, row.publicKey);
    return row.slug;
  }

  middleware = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const [pathPart, ...rest] = req.url.split('?');
      const segments = pathPart.split('/');
      let changed = false;
      for (let i = 0; i < segments.length; i += 1) {
        if (PUBLIC_KEY_PATTERN.test(segments[i])) {
          const slug = await this.slugFor(segments[i]);
          if (slug) {
            segments[i] = slug;
            changed = true;
          }
        }
      }
      if (changed) req.url = [segments.join('/'), ...rest].join('?');
    } catch (err) {
      this.logger.warn(`public key rewrite failed: ${err instanceof Error ? err.message : err}`);
    }
    next();
  };
}
