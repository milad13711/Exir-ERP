-- AlterTable
ALTER TABLE "document_referrals" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT true;

-- Backfill 1: for the same (entity, recipient) keep only the newest active referral
UPDATE "document_referrals" r
SET "status" = 'CANCELLED', "resolvedAt" = NOW(), "resolvedNote" = 'تکراری (پاکسازی مهاجرت)'
WHERE r."status" IN ('PENDING', 'ACCEPTED')
  AND EXISTS (
    SELECT 1 FROM "document_referrals" x
    WHERE x."entityType" = r."entityType" AND x."entityId" = r."entityId" AND x."toUserId" = r."toUserId"
      AND x."status" IN ('PENDING', 'ACCEPTED')
      AND (x."createdAt" > r."createdAt" OR (x."createdAt" = r."createdAt" AND x."id" > r."id"))
  );

-- Backfill 2: only the newest active referral per entity stays primary; the rest are co-workers
UPDATE "document_referrals" r
SET "isPrimary" = false
WHERE r."status" IN ('PENDING', 'ACCEPTED')
  AND EXISTS (
    SELECT 1 FROM "document_referrals" x
    WHERE x."entityType" = r."entityType" AND x."entityId" = r."entityId"
      AND x."status" IN ('PENDING', 'ACCEPTED')
      AND (x."createdAt" > r."createdAt" OR (x."createdAt" = r."createdAt" AND x."id" > r."id"))
  );

-- Partial unique indexes (not expressible in schema.prisma): race-safe concurrent refer()
CREATE UNIQUE INDEX "document_referrals_one_primary_active_key"
  ON "document_referrals" ("entityType", "entityId")
  WHERE "isPrimary" AND "status" IN ('PENDING', 'ACCEPTED');
CREATE UNIQUE INDEX "document_referrals_one_active_per_recipient_key"
  ON "document_referrals" ("entityType", "entityId", "toUserId")
  WHERE "status" IN ('PENDING', 'ACCEPTED');
