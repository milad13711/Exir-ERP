import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../generated/tenant-client/index.js';
import { purgeExpiredMedia, purgeOldText } from './messenger-purge.js';

type Media = { id: string; expiresAt: Date; purgedAt: Date | null };

function fakeDb(media: Media[], blobs: Set<string>) {
  return {
    messengerMedia: {
      findMany: async ({ where }: { where: { purgedAt: null; expiresAt: { lte: Date } } }) =>
        media.filter((m) => m.purgedAt === null && m.expiresAt <= where.expiresAt.lte).map((m) => ({ id: m.id })),
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { purgedAt: Date } }) => {
        for (const m of media) if (where.id.in.includes(m.id)) m.purgedAt = data.purgedAt;
      },
    },
    messengerMediaBlob: {
      deleteMany: async ({ where }: { where: { mediaId: { in: string[] } } }) => {
        for (const id of where.mediaId.in) blobs.delete(id);
      },
    },
  } as unknown as PrismaClient;
}

describe('purgeExpiredMedia', () => {
  it('deletes blobs of expired media only, marks them purged and keeps metadata rows', async () => {
    const now = new Date('2026-10-13T12:00:00Z');
    const media: Media[] = [
      { id: 'old', expiresAt: new Date('2026-10-13T00:00:00Z'), purgedAt: null },
      { id: 'fresh', expiresAt: new Date('2026-10-14T00:00:00Z'), purgedAt: null },
    ];
    const blobs = new Set(['old', 'fresh']);
    const n = await purgeExpiredMedia(fakeDb(media, blobs), now);
    expect(n).toBe(1);
    expect([...blobs]).toEqual(['fresh']);
    expect(media[0].purgedAt).toEqual(now);
    expect(media[1].purgedAt).toBeNull();
    // idempotent
    expect(await purgeExpiredMedia(fakeDb(media, blobs), now)).toBe(0);
  });
});

describe('purgeOldText', () => {
  it('computes the retention cutoff and spares system messages', async () => {
    let seen: unknown;
    const db = { messengerMessage: { deleteMany: async (a: unknown) => ((seen = a), { count: 3 }) } } as unknown as PrismaClient;
    const now = new Date('2026-10-12T00:00:00Z');
    expect(await purgeOldText(db, 30, now)).toBe(3);
    const where = (seen as { where: { createdAt: { lt: Date }; kind: { not: string } } }).where;
    expect(where.createdAt.lt.toISOString()).toBe('2026-09-12T00:00:00.000Z');
    expect(where.kind).toEqual({ not: 'SYSTEM' });
  });
});
