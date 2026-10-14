-- مدرک حقوقی امضای الکترونیک — additive
CREATE TABLE "signature_evidences" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "signerName" TEXT,
  "signerPhone" TEXT,
  "signerUserId" TEXT,
  "signerRole" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "device" JSONB,
  "geoStatus" TEXT NOT NULL DEFAULT 'unavailable',
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "geoAccuracy" DOUBLE PRECISION,
  "clientTime" TIMESTAMP(3),
  "serverTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "contentHash" TEXT,
  "signatureHash" TEXT,
  "integrityHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "signature_evidences_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "signature_evidences_entityType_entityId_idx" ON "signature_evidences"("entityType", "entityId");
