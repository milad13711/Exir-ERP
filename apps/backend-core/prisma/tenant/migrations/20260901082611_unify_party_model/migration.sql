-- CreateEnum
CREATE TYPE "PartyTransactionType" AS ENUM ('RECEIPT', 'PAYMENT');

-- AlterEnum
ALTER TYPE "CheckStatus" ADD VALUE 'ENDORSED';

-- AlterTable: new customer/supplier flags on the unified party model.
ALTER TABLE "crm_contacts" ADD COLUMN "isCustomer" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "isSupplier" BOOLEAN NOT NULL DEFAULT false;

-- Migrate every Supplier row into crm_contacts, reusing the SAME id so every
-- existing purchase_orders.supplierId / checks.supplierId foreign key value
-- stays valid without needing to be rewritten — only the table it points at
-- changes. isCustomer=false since a bare supplier record wasn't also a
-- customer (an existing contact who's ALSO a supplier already has one row).
INSERT INTO "crm_contacts" ("id", "type", "name", "company", "phone", "email", "address", "isCustomer", "isSupplier", "createdAt")
SELECT "id", "type", "name", "company", "phone", "email", "address", false, true, "createdAt"
FROM "suppliers";

-- Merge Check.supplierId into Check.contactId before dropping the column —
-- both referenced the same underlying party once migrated above.
UPDATE "checks" SET "contactId" = "supplierId" WHERE "supplierId" IS NOT NULL AND "contactId" IS NULL;

-- DropForeignKey
ALTER TABLE "checks" DROP CONSTRAINT "checks_supplierId_fkey";
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_supplierId_fkey";

-- AlterTable
ALTER TABLE "checks" DROP COLUMN "supplierId",
ADD COLUMN "endorsedAt" TIMESTAMP(3),
ADD COLUMN "endorsedToContactId" TEXT;

-- DropTable (data already migrated above)
DROP TABLE "suppliers";

-- CreateTable
CREATE TABLE "party_transactions" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "type" "PartyTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "accountCode" TEXT NOT NULL,
    "note" TEXT,
    "journalEntryId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "party_transactions_partyId_idx" ON "party_transactions"("partyId");

-- CreateIndex
CREATE INDEX "crm_contacts_isSupplier_idx" ON "crm_contacts"("isSupplier");

-- AddForeignKey: purchase_orders.supplierId now points at crm_contacts (values unchanged, same ids).
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "crm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checks" ADD CONSTRAINT "checks_endorsedToContactId_fkey" FOREIGN KEY ("endorsedToContactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_transactions" ADD CONSTRAINT "party_transactions_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "crm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_transactions" ADD CONSTRAINT "party_transactions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
