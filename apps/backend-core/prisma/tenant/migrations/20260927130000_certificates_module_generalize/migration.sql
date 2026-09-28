-- Generalize the Certificate model (formerly HR-only) into a standalone module:
-- recipient can now be an Employee OR a CrmContact, employeeId becomes optional
-- and survives employee deletion (archive record), and a CertificateItem list
-- + issuedByName snapshot are added. The table keeps its physical name
-- "hr_certificates" — renaming it is not required and would only add risk.

-- Rename course-title columns to the more generic title columns (data preserved).
ALTER TABLE "hr_certificates" RENAME COLUMN "courseTitleFa" TO "titleFa";
ALTER TABLE "hr_certificates" RENAME COLUMN "courseTitleEn" TO "titleEn";

-- New columns.
ALTER TABLE "hr_certificates" ADD COLUMN "crmContactId" TEXT;
ALTER TABLE "hr_certificates" ADD COLUMN "issuedByName" TEXT;

-- employeeId becomes optional: drop the old CASCADE FK, relax NOT NULL, then
-- re-add the FK with ON DELETE SET NULL so existing rows (all of which already
-- have a valid employeeId) keep working unchanged, but a future employee
-- deletion no longer deletes the certificate archive record with it.
ALTER TABLE "hr_certificates" DROP CONSTRAINT "hr_certificates_employeeId_fkey";
ALTER TABLE "hr_certificates" ALTER COLUMN "employeeId" DROP NOT NULL;
ALTER TABLE "hr_certificates" ADD CONSTRAINT "hr_certificates_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New FK for the CRM-contact recipient path.
ALTER TABLE "hr_certificates" ADD CONSTRAINT "hr_certificates_crmContactId_fkey" FOREIGN KEY ("crmContactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "hr_certificates_crmContactId_idx" ON "hr_certificates"("crmContactId");

-- CreateTable
CREATE TABLE "certificate_items" (
    "id"            TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "titleFa"       TEXT NOT NULL,
    "titleEn"       TEXT,
    "order"         INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "certificate_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "certificate_items_certificateId_idx" ON "certificate_items"("certificateId");

ALTER TABLE "certificate_items" ADD CONSTRAINT "certificate_items_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "hr_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
