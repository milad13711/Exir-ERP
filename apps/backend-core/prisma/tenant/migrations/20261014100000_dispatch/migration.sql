-- ماژول اعلام بار، بارنامه و برگ قرنطینه (dispatch) — فقط افزایشی.
-- بدون OWNED BY / تغییر مالکیت؛ توالی‌ها همان پیش‌فرض ساده‌اند.

-- ShipmentSourceType / ShipmentStatus: مقادیر جدید (استفاده‌ای در همین تراکنش ندارند)
ALTER TYPE "ShipmentSourceType" ADD VALUE IF NOT EXISTS 'PRODUCTION_ORDER';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'AWAITING_DRIVER';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'VEHICLE_ARRIVED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'CLEANLINESS_APPROVED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'TARE_RECORDED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'LOADED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'WEIGHED';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'AWAITING_DOCS';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'FINAL_CHECK';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'READY_TO_DEPART';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

-- پروفایل ارسال بار مشتری
ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "uniqueId" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "postalCode" TEXT;
ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "postalAddress" TEXT;

CREATE TABLE IF NOT EXISTS "dispatch_shipment_loadings" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "needsWeighing" BOOLEAN NOT NULL DEFAULT false,
  "productionOrderId" TEXT,
  "expectedWeightKg" DOUBLE PRECISION,
  "weighLineIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "kgPerUnit" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "customerName" TEXT,
  "uniqueId" TEXT,
  "nationalId" TEXT,
  "postalCode" TEXT,
  "postalAddress" TEXT,
  "arrivedAt" TIMESTAMP(3),
  "arrivedByUserId" TEXT,
  "arrivedByName" TEXT,
  "cleanlinessResult" TEXT,
  "cleanlinessNote" TEXT,
  "cleanlinessAt" TIMESTAMP(3),
  "cleanlinessByUserId" TEXT,
  "cleanlinessByName" TEXT,
  "tareKg" DOUBLE PRECISION,
  "tareAt" TIMESTAMP(3),
  "tareByUserId" TEXT,
  "tareByName" TEXT,
  "loadedAt" TIMESTAMP(3),
  "loaderUserId" TEXT,
  "loaderName" TEXT,
  "grossKg" DOUBLE PRECISION,
  "grossAt" TIMESTAMP(3),
  "grossByUserId" TEXT,
  "grossByName" TEXT,
  "netKg" DOUBLE PRECISION,
  "netEdited" BOOLEAN NOT NULL DEFAULT false,
  "netEditReason" TEXT,
  "weightConfirmedAt" TIMESTAMP(3),
  "weightConfirmedByUserId" TEXT,
  "weightConfirmedByName" TEXT,
  "requiredDocTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "matchedRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "docsTaskId" TEXT,
  "docsOverrideReason" TEXT,
  "docsOverrideByName" TEXT,
  "docsOverrideAt" TIMESTAMP(3),
  "finalCheckResult" TEXT,
  "finalCheckNote" TEXT,
  "loadingCorrect" BOOLEAN,
  "tarpInstalled" BOOLEAN,
  "finalCheckAt" TIMESTAMP(3),
  "finalCheckByUserId" TEXT,
  "finalCheckByName" TEXT,
  "readyGrantedAt" TIMESTAMP(3),
  "readyGrantedByUserId" TEXT,
  "readyGrantedByName" TEXT,
  "departedAt" TIMESTAMP(3),
  "departedByName" TEXT,
  "receiptOverrideReason" TEXT,
  "suspendedFrom" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_shipment_loadings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_shipment_loadings_shipmentId_key" ON "dispatch_shipment_loadings"("shipmentId");
CREATE INDEX IF NOT EXISTS "dispatch_shipment_loadings_productionOrderId_idx" ON "dispatch_shipment_loadings"("productionOrderId");
ALTER TABLE "dispatch_shipment_loadings" ADD CONSTRAINT "dispatch_shipment_loadings_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fleet_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "dispatch_shipment_events" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "actorUserId" TEXT,
  "actorName" TEXT,
  "note" TEXT,
  "reason" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_shipment_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dispatch_shipment_events_shipmentId_createdAt_idx" ON "dispatch_shipment_events"("shipmentId", "createdAt");
CREATE INDEX IF NOT EXISTS "dispatch_shipment_events_actorUserId_idx" ON "dispatch_shipment_events"("actorUserId");
ALTER TABLE "dispatch_shipment_events" ADD CONSTRAINT "dispatch_shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fleet_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "dispatch_doc_types" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_doc_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_doc_types_code_key" ON "dispatch_doc_types"("code");

CREATE TABLE IF NOT EXISTS "dispatch_doc_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "minNetKg" DOUBLE PRECISION,
  "cargoTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "docTypeCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "handlerRoleId" TEXT,
  "handlerUserId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_doc_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "dispatch_shipment_documents" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "docTypeCode" TEXT NOT NULL,
  "step" TEXT,
  "attachmentId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "createdByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_shipment_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dispatch_shipment_documents_shipmentId_docTypeCode_idx" ON "dispatch_shipment_documents"("shipmentId", "docTypeCode");
ALTER TABLE "dispatch_shipment_documents" ADD CONSTRAINT "dispatch_shipment_documents_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fleet_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "dispatch_receipts" (
  "id" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "signedAt" TIMESTAMP(3),
  "signerName" TEXT,
  "signerPhone" TEXT,
  "signatureData" TEXT,
  "evidenceId" TEXT,
  "paperAttachmentId" TEXT,
  "paperByUserId" TEXT,
  "paperByName" TEXT,
  "pdfAttachmentId" TEXT,
  "archivedDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_receipts_shipmentId_key" ON "dispatch_receipts"("shipmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_receipts_publicToken_key" ON "dispatch_receipts"("publicToken");
ALTER TABLE "dispatch_receipts" ADD CONSTRAINT "dispatch_receipts_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "fleet_shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "dispatch_suggestions" (
  "id" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "shipmentId" TEXT,
  "title" TEXT,
  "notifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_suggestions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_suggestions_sourceType_sourceId_key" ON "dispatch_suggestions"("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "dispatch_suggestions_status_idx" ON "dispatch_suggestions"("status");

CREATE TABLE IF NOT EXISTS "dispatch_production_triggers" (
  "id" TEXT NOT NULL,
  "productionOrderId" TEXT NOT NULL,
  "stagesBeforeEnd" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_production_triggers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dispatch_production_triggers_productionOrderId_key" ON "dispatch_production_triggers"("productionOrderId");

CREATE TABLE IF NOT EXISTS "dispatch_invoice_adjustments" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "shipmentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "netWeightKg" DOUBLE PRECISION NOT NULL,
  "lineChanges" JSONB NOT NULL,
  "oldSubtotal" INTEGER NOT NULL,
  "newSubtotal" INTEGER NOT NULL,
  "oldDiscount" INTEGER NOT NULL,
  "newDiscount" INTEGER NOT NULL,
  "oldTaxAmount" INTEGER NOT NULL,
  "newTaxAmount" INTEGER NOT NULL,
  "oldTotal" INTEGER NOT NULL,
  "newTotal" INTEGER NOT NULL,
  "proposedByUserId" TEXT,
  "decidedByUserId" TEXT,
  "decidedByName" TEXT,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "finalizedAt" TIMESTAMP(3),
  "finalizeError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dispatch_invoice_adjustments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "dispatch_invoice_adjustments_invoiceId_idx" ON "dispatch_invoice_adjustments"("invoiceId");
CREATE INDEX IF NOT EXISTS "dispatch_invoice_adjustments_shipmentId_idx" ON "dispatch_invoice_adjustments"("shipmentId");

-- نوع‌های سند پیش‌فرض (در صورت نبودن)
INSERT INTO "dispatch_doc_types" ("id","code","name","isSystem","sortOrder") VALUES
  (gen_random_uuid()::text,'WAYBILL','بارنامه',true,1),
  (gen_random_uuid()::text,'QUARANTINE','برگ قرنطینه',true,2),
  (gen_random_uuid()::text,'WEIGHBRIDGE_TICKET','قبض باسکول',true,3),
  (gen_random_uuid()::text,'SIGNED_RECEIPT','رسید امضاشده',true,4),
  (gen_random_uuid()::text,'OTHER','سایر',true,5)
ON CONFLICT ("code") DO NOTHING;
