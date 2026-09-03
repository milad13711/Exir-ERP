-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "zarinpalAuthority" TEXT,
ADD COLUMN "paymentRefId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_zarinpalAuthority_key" ON "invoices"("zarinpalAuthority");
