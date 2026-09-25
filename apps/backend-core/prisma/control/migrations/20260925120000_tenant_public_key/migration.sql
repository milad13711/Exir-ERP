ALTER TABLE "tenants" ADD COLUMN "publicKey" TEXT NOT NULL DEFAULT ('t' || substr(md5(random()::text || clock_timestamp()::text), 1, 11));

CREATE UNIQUE INDEX "tenants_publicKey_key" ON "tenants"("publicKey");
