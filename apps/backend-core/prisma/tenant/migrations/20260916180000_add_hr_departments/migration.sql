-- Needed for gen_random_uuid() below, used only to backfill ids for the
-- new hr_departments rows created from existing free-text values.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateTable
CREATE TABLE "hr_departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_departments_pkey" PRIMARY KEY ("id")
);

-- Backfill: one Department row per distinct non-empty "department" string
-- that ever existed on hr_employees, so no existing data is lost.
INSERT INTO "hr_departments" ("id", "name", "createdAt")
SELECT gen_random_uuid(), t.department, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT department FROM "hr_employees" WHERE department IS NOT NULL AND department <> '') t;

-- AlterTable
ALTER TABLE "hr_employees" ADD COLUMN "departmentId" TEXT;

-- Point every employee at the department row matching their old string value.
UPDATE "hr_employees" e
SET "departmentId" = d.id
FROM "hr_departments" d
WHERE e.department = d.name;

ALTER TABLE "hr_employees" DROP COLUMN "department";

-- CreateIndex
CREATE UNIQUE INDEX "hr_departments_name_key" ON "hr_departments"("name");

-- CreateIndex
CREATE INDEX "hr_departments_managerId_idx" ON "hr_departments"("managerId");

-- CreateIndex
CREATE INDEX "hr_employees_departmentId_idx" ON "hr_employees"("departmentId");

-- AddForeignKey
ALTER TABLE "hr_departments" ADD CONSTRAINT "hr_departments_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "hr_employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "hr_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
