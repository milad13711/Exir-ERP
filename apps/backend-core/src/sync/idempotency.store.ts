import { Injectable } from '@nestjs/common';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';
import { IDEMPOTENCY_TTL_MS, type ClaimInput, type IdemRecord, type IdempotencyStore } from './idempotency.js';

/** پیاده‌سازی Prisma: claim = INSERT با یکتایی (userId,key)؛ P2002 یعنی کلید قبلاً گرفته شده. */
export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: TenantPrismaClient) {}

  async claim(input: ClaimInput): Promise<{ claimed: true; id: string } | { claimed: false; existing: IdemRecord }> {
    try {
      const row = await this.db.syncIdempotency.create({
        data: {
          userId: input.userId,
          key: input.key,
          method: input.method,
          path: input.path,
          requestHash: input.requestHash,
          status: 'PENDING',
          offlineCreatedAt: input.offlineCreatedAt,
          createdAt: input.now,
          expiresAt: new Date(input.now.getTime() + IDEMPOTENCY_TTL_MS),
        },
        select: { id: true },
      });
      return { claimed: true as const, id: row.id };
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
      const existing = await this.db.syncIdempotency.findUnique({ where: { userId_key: { userId: input.userId, key: input.key } } });
      if (!existing) return this.claim(input); // بین create و find حذف شد — دوباره
      return { claimed: false as const, existing: existing as unknown as IdemRecord };
    }
  }

  async complete(id: string, data: { responseStatus: number; responseBody: unknown; resourceId: string | null }) {
    await this.db.syncIdempotency.update({
      where: { id },
      data: {
        status: 'DONE',
        responseStatus: data.responseStatus,
        responseBody: (data.responseBody ?? undefined) as never,
        resourceId: data.resourceId,
        completedAt: new Date(),
      },
    });
  }

  async countForUser(userId: string, now: Date) {
    return this.db.syncIdempotency.count({ where: { userId, expiresAt: { gt: now } } });
  }

  async markUnknown(id: string) {
    await this.db.syncIdempotency.update({ where: { id }, data: { status: 'UNKNOWN', completedAt: new Date() } });
  }

  async release(id: string) {
    await this.db.syncIdempotency.deleteMany({ where: { id, status: 'PENDING' } });
  }

  async evict(id: string) {
    const r = await this.db.syncIdempotency.deleteMany({ where: { id } });
    return r.count > 0;
  }
}

@Injectable()
export class IdempotencyStoreFactory {
  forTenant(db: TenantPrismaClient): IdempotencyStore {
    return new PrismaIdempotencyStore(db);
  }
}
