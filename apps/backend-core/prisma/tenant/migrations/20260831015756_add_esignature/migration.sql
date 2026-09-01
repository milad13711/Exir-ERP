-- AlterTable
ALTER TABLE "sales_invoices" ADD COLUMN     "deliveryCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "deliveryCodeHash" TEXT,
ADD COLUMN     "deliveryCodeSentAt" TIMESTAMP(3),
ADD COLUMN     "deliveryConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryConfirmedName" TEXT,
ADD COLUMN     "deliverySignatureDataUrl" TEXT,
ADD COLUMN     "isOfficial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signatureDataUrl" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedByName" TEXT,
ADD COLUMN     "signedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

