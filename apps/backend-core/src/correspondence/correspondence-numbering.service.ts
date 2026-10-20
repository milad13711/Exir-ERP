import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { LETTER_TYPE_LABELS, type LetterType } from './correspondence.constants.js';
import { COUNTER_UPSERT_SQL, DEFAULT_PATTERNS, allocateNumber, formatLetterNumber, newCounterId, periodKeyFor, type AllocatedNumber, type NumberingSchemeLike } from './numbering.js';

type Db = TenantPrismaClient | Prisma.TransactionClient;

@Injectable()
export class CorrespondenceNumberingService {
  /** طرح پیش‌فرضِ فعال برای نوع نامه؛ اگر هیچ طرحی نبود یک طرح پیش‌فرض ساخته می‌شود. */
  async schemeFor(db: Db, type: LetterType): Promise<NumberingSchemeLike> {
    const found =
      (await db.corrNumberingScheme.findFirst({ where: { type, isActive: true, isDefault: true } })) ??
      (await db.corrNumberingScheme.findFirst({ where: { type, isActive: true }, orderBy: { createdAt: 'asc' } }));
    if (found) return found;
    return db.corrNumberingScheme.create({
      data: { name: `شماره‌گذاری ${LETTER_TYPE_LABELS[type]}`, type, pattern: DEFAULT_PATTERNS[type], resetPolicy: 'YEARLY', startAt: 1, isDefault: true },
    });
  }

  /**
   * تخصیص اتمیک شماره — فقط درون تراکنش صدور صدا زده شود (رول‌بک، شماره را هم برمی‌گرداند).
   * INSERT … ON CONFLICT DO UPDATE … RETURNING روی ردیف شمارنده قفل ردیف می‌گیرد؛ درخواست‌های هم‌زمان پشت هم می‌ایستند.
   */
  async issue(tx: Prisma.TransactionClient, type: LetterType, at: Date, categoryId?: string | null): Promise<AllocatedNumber> {
    const scheme = await this.schemeFor(tx, type);
    const cat = categoryId ? await tx.corrLetterCategory.findUnique({ where: { id: categoryId }, select: { code: true } }) : null;
    return allocateNumber(
      async (schemeId, periodKey, startAt) => {
        const rows = await tx.$queryRawUnsafe<{ lastSeq: number }[]>(COUNTER_UPSERT_SQL, newCounterId(), schemeId, periodKey, startAt);
        return Number(rows[0].lastSeq);
      },
      scheme,
      { type, at, categoryCode: cat?.code ?? null },
    );
  }

  /** پیش‌نمایش شماره‌ی بعدی (بدون مصرف شمارنده؛ فقط راهنماست و تضمین نمی‌شود). */
  async preview(db: Db, type: LetterType, categoryId?: string | null, at = new Date()): Promise<{ next: string; schemeId: string; pattern: string }> {
    const scheme = await this.schemeFor(db, type);
    const periodKey = periodKeyFor(scheme.resetPolicy as never, at);
    const counter = await db.corrNumberCounter.findUnique({ where: { schemeId_periodKey: { schemeId: scheme.id, periodKey } } });
    const seq = counter ? counter.lastSeq + 1 : scheme.startAt;
    const cat = categoryId ? await db.corrLetterCategory.findUnique({ where: { id: categoryId }, select: { code: true } }) : null;
    return { next: formatLetterNumber(scheme.pattern, { seq, at, type, categoryCode: cat?.code ?? null }), schemeId: scheme.id, pattern: scheme.pattern };
  }

  assertValidPattern(error: string | null): void {
    if (error) throw new BadRequestException(error);
  }
}
