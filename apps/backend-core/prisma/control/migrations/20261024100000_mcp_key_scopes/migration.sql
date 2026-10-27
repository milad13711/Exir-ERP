-- دامنه‌ی دسترسی کلید API (افزودنی؛ کلیدهای موجود با scopes خالی = دسترسی کامل قدیمی می‌مانند)
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "lastUsedIp" TEXT;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "useCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rotatedFromId" TEXT;
