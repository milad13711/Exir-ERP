-- Certificates: snapshot of the recipient's national ID (شماره ملی) at issue time.
-- Nullable so all existing certificates stay valid; template/body-text changes
-- live in the ModuleSetting JSON and need no migration.
ALTER TABLE "hr_certificates" ADD COLUMN "nationalId" TEXT;
