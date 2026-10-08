-- AlterTable (additive): forced password change flag + last login time for platform admins
ALTER TABLE "admin_users" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastLoginAt" TIMESTAMP(3);
