ALTER TABLE "appointments" ADD COLUMN "providerToken" TEXT;
UPDATE "appointments" SET "providerToken" = gen_random_uuid()::text WHERE "providerToken" IS NULL;
ALTER TABLE "appointments" ALTER COLUMN "providerToken" SET NOT NULL;
CREATE UNIQUE INDEX "appointments_providerToken_key" ON "appointments"("providerToken");

ALTER TABLE "reseller_profiles" ADD COLUMN "bio" TEXT;
