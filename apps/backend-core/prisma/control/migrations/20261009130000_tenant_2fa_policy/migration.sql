-- AlterTable (additive): mandatory 2FA for tenant OWNER/ADMIN — per-membership grace clock + per-tenant policy override
ALTER TABLE "tenant_memberships" ADD COLUMN "twoFactorGraceStartedAt" TIMESTAMP(3);
ALTER TABLE "tenants" ADD COLUMN "twoFactorPolicy" TEXT;
