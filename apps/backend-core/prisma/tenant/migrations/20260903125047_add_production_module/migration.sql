-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'RAW_MATERIAL_APPROVED', 'IN_PROGRESS', 'QC_PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionStageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_CONSUME';
ALTER TYPE "StockMovementType" ADD VALUE 'PRODUCTION_YIELD';

-- CreateTable
CREATE TABLE "production_boms" (
    "id" TEXT NOT NULL,
    "outputProductId" TEXT NOT NULL,
    "batchOutputQty" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_bom_lines" (
    "id" TEXT NOT NULL,
    "bomId" TEXT NOT NULL,
    "rawMaterialProductId" TEXT NOT NULL,
    "quantityPerBatch" INTEGER NOT NULL,

    CONSTRAINT "production_bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "orderNo" SERIAL NOT NULL,
    "bomId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantityPlanned" INTEGER NOT NULL,
    "quantityProduced" INTEGER,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "relatedInvoiceId" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "rawMaterialApprovedByUserId" TEXT,
    "rawMaterialApprovedAt" TIMESTAMP(3),
    "rawMaterialApprovalNotes" TEXT,
    "qualityApprovedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_work_centers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequenceOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "production_work_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_stages" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "workCenterId" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "sequenceOrder" INTEGER NOT NULL,
    "status" "ProductionStageStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "report" TEXT,

    CONSTRAINT "production_order_stages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "production_boms_outputProductId_idx" ON "production_boms"("outputProductId");

-- CreateIndex
CREATE INDEX "production_bom_lines_bomId_idx" ON "production_bom_lines"("bomId");

-- CreateIndex
CREATE INDEX "production_orders_status_idx" ON "production_orders"("status");

-- CreateIndex
CREATE INDEX "production_orders_bomId_idx" ON "production_orders"("bomId");

-- CreateIndex
CREATE INDEX "production_order_stages_productionOrderId_idx" ON "production_order_stages"("productionOrderId");

-- AddForeignKey
ALTER TABLE "production_boms" ADD CONSTRAINT "production_boms_outputProductId_fkey" FOREIGN KEY ("outputProductId") REFERENCES "warehouse_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_boms" ADD CONSTRAINT "production_boms_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "production_boms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_bom_lines" ADD CONSTRAINT "production_bom_lines_rawMaterialProductId_fkey" FOREIGN KEY ("rawMaterialProductId") REFERENCES "warehouse_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "production_boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_rawMaterialApprovedByUserId_fkey" FOREIGN KEY ("rawMaterialApprovedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stages" ADD CONSTRAINT "production_order_stages_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stages" ADD CONSTRAINT "production_order_stages_workCenterId_fkey" FOREIGN KEY ("workCenterId") REFERENCES "production_work_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_stages" ADD CONSTRAINT "production_order_stages_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
