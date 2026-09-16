-- ration_samples.status: real 6-step workflow replaces the old 3-step one.
ALTER TYPE "RationSampleStatus" RENAME TO "RationSampleStatus_old";
CREATE TYPE "RationSampleStatus" AS ENUM ('COLLECTED', 'IN_TRANSIT', 'LAB_CONFIRMED', 'REPORT_SUBMITTED', 'SENT_TO_EXPERT', 'VIEWED_BY_FARMER');

ALTER TABLE "ration_samples" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ration_samples" ALTER COLUMN "status" TYPE "RationSampleStatus" USING (
  CASE "status"::text
    WHEN 'AWAITING_LAB' THEN 'COLLECTED'
    WHEN 'LAB_REVIEWED' THEN 'SENT_TO_EXPERT'
    WHEN 'RESULT_SHARED' THEN 'VIEWED_BY_FARMER'
  END
)::"RationSampleStatus";
ALTER TABLE "ration_samples" ALTER COLUMN "status" SET DEFAULT 'COLLECTED';
DROP TYPE "RationSampleStatus_old";

-- ration_samples.sampleCode ("RS-1405-000123") -> sampleNo (plain autoincrement integer).
ALTER TABLE "ration_samples" ADD COLUMN "sampleNo" INTEGER;

WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY "createdAt") AS rn FROM "ration_samples"
)
UPDATE "ration_samples" s SET "sampleNo" = numbered.rn FROM numbered WHERE s.id = numbered.id;

DROP INDEX IF EXISTS "ration_samples_sampleCode_key";
ALTER TABLE "ration_samples" DROP COLUMN "sampleCode";

CREATE SEQUENCE IF NOT EXISTS "ration_samples_sampleNo_seq";
SELECT setval('"ration_samples_sampleNo_seq"', COALESCE((SELECT MAX("sampleNo") FROM "ration_samples"), 0) + 1, false);
ALTER TABLE "ration_samples" ALTER COLUMN "sampleNo" SET DEFAULT nextval('"ration_samples_sampleNo_seq"');
ALTER SEQUENCE "ration_samples_sampleNo_seq" OWNED BY "ration_samples"."sampleNo";
ALTER TABLE "ration_samples" ALTER COLUMN "sampleNo" SET NOT NULL;
CREATE UNIQUE INDEX "ration_samples_sampleNo_key" ON "ration_samples"("sampleNo");

-- Who/when confirmed physical receipt at the lab — distinct from the report's own reviewedByPhone.
ALTER TABLE "ration_samples" ADD COLUMN "labConfirmedByPhone" TEXT;
ALTER TABLE "ration_samples" ADD COLUMN "labConfirmedAt" TIMESTAMP(3);

-- users.navOrder: per-user manual sidebar ordering (empty = use the default category-grouped order).
ALTER TABLE "users" ADD COLUMN "navOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
