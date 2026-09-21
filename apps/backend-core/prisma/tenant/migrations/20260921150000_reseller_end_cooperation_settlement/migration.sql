CREATE TYPE "ResellerCooperationStatus" AS ENUM ('ACTIVE', 'END_REQUESTED', 'ENDED');
CREATE TYPE "ResellerSettlementStatus" AS ENUM ('ISSUED', 'SETTLED');

ALTER TABLE "reseller_profiles"
  ADD COLUMN "cooperationStatus" "ResellerCooperationStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "endRequestedAt" TIMESTAMP(3),
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "endReason" TEXT,
  ADD COLUMN "hiddenFromMap" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "reseller_settlements" (
  "id" TEXT NOT NULL,
  "number" SERIAL NOT NULL,
  "resellerProfileId" TEXT NOT NULL,
  "totalCommission" INTEGER NOT NULL,
  "paidCommission" INTEGER NOT NULL,
  "amountDue" INTEGER NOT NULL,
  "lines" JSONB NOT NULL,
  "note" TEXT,
  "status" "ResellerSettlementStatus" NOT NULL DEFAULT 'ISSUED',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "settledAt" TIMESTAMP(3),
  CONSTRAINT "reseller_settlements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reseller_settlements_number_key" ON "reseller_settlements"("number");
CREATE INDEX "reseller_settlements_resellerProfileId_idx" ON "reseller_settlements"("resellerProfileId");
ALTER TABLE "reseller_settlements" ADD CONSTRAINT "reseller_settlements_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "reseller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
