-- License system v2 (additive). No ownership-sensitive statements (no triggers/roles/extensions).
-- Existing rows keep working: licenseKey is backfilled by the app at boot (CSPRNG), signedKey stays valid as an offline token.

ALTER TYPE "LicenseStatus" ADD VALUE IF NOT EXISTS 'SUSPENDED';

ALTER TABLE "licenses" ALTER COLUMN "expiresAt" DROP NOT NULL;
ALTER TABLE "licenses" ALTER COLUMN "signedKey" DROP NOT NULL;

ALTER TABLE "licenses"
  ADD COLUMN "licenseKey" TEXT,
  ADD COLUMN "productName" TEXT NOT NULL DEFAULT 'exir-erp',
  ADD COLUMN "edition" TEXT,
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "customerEmail" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "maxActivations" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatesUntil" TIMESTAMP(3),
  ADD COLUMN "graceDays" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "integrityPolicy" TEXT NOT NULL DEFAULT 'WARN',
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedReason" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastAppVersion" TEXT,
  ADD COLUMN "lastTamperStatus" TEXT,
  ADD COLUMN "lastTelemetry" JSONB;

CREATE UNIQUE INDEX "licenses_licenseKey_key" ON "licenses"("licenseKey");
CREATE INDEX "licenses_status_deletedAt_idx" ON "licenses"("status", "deletedAt");

CREATE TABLE "license_activations" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "fingerprint" JSONB,
    "ip" TEXT,
    "appVersion" TEXT,
    "tamperStatus" TEXT,
    "lastTelemetry" JSONB,
    "activatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastTokenAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    CONSTRAINT "license_activations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "license_activations_licenseId_identifier_idx" ON "license_activations"("licenseId", "identifier");
CREATE INDEX "license_activations_licenseId_deletedAt_idx" ON "license_activations"("licenseId", "deletedAt");
ALTER TABLE "license_activations" ADD CONSTRAINT "license_activations_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "license_events" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT,
    "licenseKeyHint" TEXT,
    "kind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "code" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "ip" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "license_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "license_events_licenseId_createdAt_idx" ON "license_events"("licenseId", "createdAt");
CREATE INDEX "license_events_kind_createdAt_idx" ON "license_events"("kind", "createdAt");

CREATE TABLE "license_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "license_settings_pkey" PRIMARY KEY ("key")
);
