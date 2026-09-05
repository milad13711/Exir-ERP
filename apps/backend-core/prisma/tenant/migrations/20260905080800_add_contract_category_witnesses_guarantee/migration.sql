-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "category" TEXT,
ADD COLUMN     "guaranteeTerms" TEXT,
ADD COLUMN     "referredSignerUserId" TEXT;

-- CreateTable
CREATE TABLE "contract_witnesses" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3),
    "signatureDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_witnesses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_witnesses_contractId_idx" ON "contract_witnesses"("contractId");

-- CreateIndex
CREATE INDEX "contracts_category_idx" ON "contracts"("category");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_referredSignerUserId_fkey" FOREIGN KEY ("referredSignerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_witnesses" ADD CONSTRAINT "contract_witnesses_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
