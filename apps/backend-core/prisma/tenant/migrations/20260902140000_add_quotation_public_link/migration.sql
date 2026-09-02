-- AlterTable
ALTER TABLE "sales_quotations"
  ADD COLUMN "publicToken" TEXT NOT NULL DEFAULT (gen_random_uuid()::text),
  ADD COLUMN "firstViewedAt" TIMESTAMP(3),
  ADD COLUMN "acceptedByName" TEXT,
  ADD COLUMN "acceptedSignatureDataUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sales_quotations_publicToken_key" ON "sales_quotations"("publicToken");
