ALTER TABLE "service_types"
  ADD COLUMN "requiresFullPayment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "linkToMentoring" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "appointments"
  ADD COLUMN "isFullPayment" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "location" TEXT;
