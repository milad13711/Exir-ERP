-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_IN';

-- CreateTable
CREATE TABLE "warehouses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "address" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_code_key" ON "warehouses"("code");

-- Seed one default warehouse so existing stock movements have somewhere to point.
INSERT INTO "warehouses" ("id", "name", "code", "isDefault", "isActive")
VALUES (gen_random_uuid()::text, 'انبار مرکزی', 'MAIN', true, true);

-- AlterTable: add nullable first, backfill from the default warehouse, then enforce NOT NULL.
ALTER TABLE "warehouse_stock_movements" ADD COLUMN "transferGroupId" TEXT;
ALTER TABLE "warehouse_stock_movements" ADD COLUMN "warehouseId" TEXT;

UPDATE "warehouse_stock_movements"
SET "warehouseId" = (SELECT "id" FROM "warehouses" WHERE "isDefault" = true LIMIT 1)
WHERE "warehouseId" IS NULL;

ALTER TABLE "warehouse_stock_movements" ALTER COLUMN "warehouseId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "warehouse_stock_movements_warehouseId_idx" ON "warehouse_stock_movements"("warehouseId");

-- AddForeignKey
ALTER TABLE "warehouse_stock_movements" ADD CONSTRAINT "warehouse_stock_movements_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
