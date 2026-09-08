-- CreateEnum
CREATE TYPE "IndustryBusinessCategory" AS ENUM ('SERVICES', 'TRADE', 'PRODUCTION');

-- AlterTable
ALTER TABLE "industry_templates" ADD COLUMN     "businessCategory" "IndustryBusinessCategory";
