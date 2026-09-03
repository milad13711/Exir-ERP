-- CreateEnum
CREATE TYPE "QualitySampleSource" AS ENUM ('IN_PROCESS', 'FINAL_PRODUCT');

-- CreateEnum
CREATE TYPE "QualityVerdict" AS ENUM ('PENDING', 'PASS', 'FAIL');

-- CreateTable
CREATE TABLE "quality_test_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "acceptableMin" DECIMAL(10,3),
    "acceptableMax" DECIMAL(10,3),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_test_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_samples" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "productionOrderStageId" TEXT,
    "source" "QualitySampleSource" NOT NULL,
    "sampledByUserId" TEXT,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "verdict" "QualityVerdict" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_sample_results" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "testTypeId" TEXT NOT NULL,
    "measuredValue" DECIMAL(10,3) NOT NULL,
    "verdict" "QualityVerdict" NOT NULL,
    "testedByUserId" TEXT,
    "testedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "quality_sample_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_samples_productionOrderId_idx" ON "quality_samples"("productionOrderId");

-- CreateIndex
CREATE INDEX "quality_sample_results_sampleId_idx" ON "quality_sample_results"("sampleId");

-- AddForeignKey
ALTER TABLE "quality_samples" ADD CONSTRAINT "quality_samples_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_samples" ADD CONSTRAINT "quality_samples_productionOrderStageId_fkey" FOREIGN KEY ("productionOrderStageId") REFERENCES "production_order_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_samples" ADD CONSTRAINT "quality_samples_sampledByUserId_fkey" FOREIGN KEY ("sampledByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sample_results" ADD CONSTRAINT "quality_sample_results_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "quality_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sample_results" ADD CONSTRAINT "quality_sample_results_testTypeId_fkey" FOREIGN KEY ("testTypeId") REFERENCES "quality_test_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_sample_results" ADD CONSTRAINT "quality_sample_results_testedByUserId_fkey" FOREIGN KEY ("testedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
