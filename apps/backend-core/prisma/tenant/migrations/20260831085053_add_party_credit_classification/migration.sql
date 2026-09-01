-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN     "bankAvgMonthlyTurnover" INTEGER,
ADD COLUMN     "creditLimitOverride" INTEGER,
ADD COLUMN     "hasBouncedChecks" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "type" "CrmContactType" NOT NULL DEFAULT 'COMPANY';

