-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "themeColor" TEXT;

-- AlterTable
ALTER TABLE "industry_templates" ADD COLUMN "suggestedThemeColor" TEXT,
ADD COLUMN "defaultModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
