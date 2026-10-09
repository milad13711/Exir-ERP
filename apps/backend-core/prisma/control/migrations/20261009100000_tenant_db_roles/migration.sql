-- AlterTable (additive, nullable): per-tenant Postgres role credentials (S-14).
-- NULL = tenant still uses the legacy shared credentials, so rollout is staged per tenant.
ALTER TABLE "tenants" ADD COLUMN "dbUser" TEXT,
ADD COLUMN "dbPasswordEnc" TEXT;
