-- ویرایش/ابطال فاکتور و پیش‌فاکتور + ویرایش/ابطال رسید و حواله‌ی انبار + ورود موجودی اولیه از اکسل
-- (کاملاً افزودنی؛ بدون دستور وابسته به مالکیت)

ALTER TYPE "SalesQuotationStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

ALTER TABLE "sales_quotations"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelReason" TEXT,
  ADD COLUMN "revisionCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sales_invoices"
  ADD COLUMN "revisionCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastEditedAt" TIMESTAMP(3);

CREATE TABLE "warehouse_stock_import_batches" (
  "id" TEXT NOT NULL,
  "fileName" TEXT,
  "fileHash" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "totalQuantity" INTEGER NOT NULL,
  "totalValue" BIGINT NOT NULL,
  "createdProducts" INTEGER NOT NULL DEFAULT 0,
  "journalEntryId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedAt" TIMESTAMP(3),
  "voidReason" TEXT,
  "voidedByUserId" TEXT,
  CONSTRAINT "warehouse_stock_import_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "warehouse_stock_import_batches_fileHash_idx" ON "warehouse_stock_import_batches"("fileHash");

ALTER TABLE "warehouse_stock_movements"
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "editCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "voidedByUserId" TEXT,
  ADD COLUMN "reversalOfId" TEXT,
  ADD COLUMN "importBatchId" TEXT;

CREATE UNIQUE INDEX "warehouse_stock_movements_reversalOfId_key" ON "warehouse_stock_movements"("reversalOfId");
CREATE INDEX "warehouse_stock_movements_importBatchId_idx" ON "warehouse_stock_movements"("importBatchId");
ALTER TABLE "warehouse_stock_movements"
  ADD CONSTRAINT "warehouse_stock_movements_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "warehouse_stock_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "document_revisions" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "revisionNo" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "before" JSONB,
  "after" JSONB,
  "changes" JSONB,
  "userId" TEXT,
  "userName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_revisions_entityType_entityId_revisionNo_key" ON "document_revisions"("entityType", "entityId", "revisionNo");
CREATE INDEX "document_revisions_entityType_entityId_idx" ON "document_revisions"("entityType", "entityId");
