/*
  Warnings:

  - A unique constraint covering the columns `[publicToken]` on the table `contracts` will be added. If there are existing duplicate values, this will fail.
  - The required column `publicToken` was added to the `contracts` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- CreateEnum
CREATE TYPE "ContractPartyMode" AS ENUM ('INTERNAL', 'EXTERNAL', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "ContractLegalCategory" AS ENUM ('NOTARIZED', 'LAWYER_SUPERVISED', 'GENERAL');

-- CreateEnum
CREATE TYPE "ContractPartySide" AS ENUM ('PARTY_A', 'PARTY_B');

-- DropForeignKey
ALTER TABLE "contracts" DROP CONSTRAINT "contracts_contactId_fkey";

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "isLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "legalCategory" "ContractLegalCategory" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "partyASignatureDataUrl" TEXT,
ADD COLUMN     "partyASignedAt" TIMESTAMP(3),
ADD COLUMN     "partyASignerName" TEXT,
ADD COLUMN     "partyBSignatureDataUrl" TEXT,
ADD COLUMN     "partyBSignedAt" TIMESTAMP(3),
ADD COLUMN     "partyBSignerName" TEXT,
ADD COLUMN     "partyMode" "ContractPartyMode" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN     "publicToken" TEXT NOT NULL,
ADD COLUMN     "secondPartyContactId" TEXT,
ADD COLUMN     "secondPartyName" TEXT,
ADD COLUMN     "secondPartyPhone" TEXT,
ADD COLUMN     "templateId" TEXT,
ALTER COLUMN "type" DROP NOT NULL,
ALTER COLUMN "contactId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partyMode" "ContractPartyMode" NOT NULL DEFAULT 'EXTERNAL',
    "type" "ContractType",
    "body" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_edit_requests" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "side" "ContractPartySide" NOT NULL,
    "text" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_edit_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_amendments" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "contentHash" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "partyASignedAt" TIMESTAMP(3),
    "partyASignatureDataUrl" TEXT,
    "partyBSignedAt" TIMESTAMP(3),
    "partyBSignatureDataUrl" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_edit_requests_contractId_idx" ON "contract_edit_requests"("contractId");

-- CreateIndex
CREATE INDEX "contract_amendments_contractId_idx" ON "contract_amendments"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_publicToken_key" ON "contracts"("publicToken");

-- AddForeignKey
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_secondPartyContactId_fkey" FOREIGN KEY ("secondPartyContactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_edit_requests" ADD CONSTRAINT "contract_edit_requests_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
