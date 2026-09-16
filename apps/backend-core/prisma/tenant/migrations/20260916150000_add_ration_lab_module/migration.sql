-- CreateEnum
CREATE TYPE "RationSampleStatus" AS ENUM ('AWAITING_LAB', 'LAB_REVIEWED', 'RESULT_SHARED');

-- CreateEnum
CREATE TYPE "RationLineKind" AS ENUM ('CURRENT', 'PROPOSED');

-- CreateTable
CREATE TABLE "ration_samples" (
    "id" TEXT NOT NULL,
    "sampleCode" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "collectedByUserId" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL,
    "herdSize" INTEGER,
    "totalHerdMilkYieldLiters" DECIMAL(10,2),
    "avgMilkYieldPerAnimalLiters" DECIMAL(10,2),
    "milkFatPercent" DECIMAL(5,2),
    "milkProteinPercent" DECIMAL(5,2),
    "currentRationDescription" TEXT,
    "consentSignatureDataUrl" TEXT NOT NULL,
    "consentAcceptedAt" TIMESTAMP(3) NOT NULL,
    "analysisFeeAmount" INTEGER NOT NULL DEFAULT 0,
    "discountCode" TEXT,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "finalFeeAmount" INTEGER NOT NULL DEFAULT 0,
    "isIdentityVisibleToLab" BOOLEAN NOT NULL DEFAULT true,
    "status" "RationSampleStatus" NOT NULL DEFAULT 'AWAITING_LAB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ration_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_formula_lines" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "kind" "RationLineKind" NOT NULL,
    "ingredientName" TEXT NOT NULL,
    "quantityPerAnimalKg" DECIMAL(10,3) NOT NULL,
    "unitCostSnapshot" INTEGER NOT NULL,
    "lineCost" INTEGER NOT NULL,

    CONSTRAINT "ration_formula_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_lab_reports" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "reviewedByPhone" TEXT NOT NULL,
    "reviewedByName" TEXT,
    "currentRationIssues" TEXT NOT NULL,
    "riskIfUnchanged" TEXT NOT NULL,
    "newRecommendations" TEXT NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "urgentWarningSigns" TEXT NOT NULL,
    "isKnowledge" BOOLEAN NOT NULL DEFAULT false,
    "knowledgeReportId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ration_lab_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_lab_reviewers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ration_lab_reviewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_followup_checkins" (
    "id" TEXT NOT NULL,
    "sampleId" TEXT NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "herdSize" INTEGER,
    "totalHerdMilkYieldLiters" DECIMAL(10,2),
    "avgMilkYieldPerAnimalLiters" DECIMAL(10,2),
    "milkFatPercent" DECIMAL(5,2),
    "milkProteinPercent" DECIMAL(5,2),
    "notes" TEXT,

    CONSTRAINT "ration_followup_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_discount_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "percentOff" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "redemptionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ration_discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ration_samples_sampleCode_key" ON "ration_samples"("sampleCode");

-- CreateIndex
CREATE INDEX "ration_samples_contactId_idx" ON "ration_samples"("contactId");

-- CreateIndex
CREATE INDEX "ration_formula_lines_sampleId_idx" ON "ration_formula_lines"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "ration_lab_reports_sampleId_key" ON "ration_lab_reports"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "ration_lab_reviewers_phone_key" ON "ration_lab_reviewers"("phone");

-- CreateIndex
CREATE INDEX "ration_followup_checkins_sampleId_idx" ON "ration_followup_checkins"("sampleId");

-- CreateIndex
CREATE UNIQUE INDEX "ration_discount_codes_code_key" ON "ration_discount_codes"("code");

-- AddForeignKey
ALTER TABLE "ration_samples" ADD CONSTRAINT "ration_samples_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_samples" ADD CONSTRAINT "ration_samples_collectedByUserId_fkey" FOREIGN KEY ("collectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_formula_lines" ADD CONSTRAINT "ration_formula_lines_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "ration_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_lab_reports" ADD CONSTRAINT "ration_lab_reports_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "ration_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_lab_reports" ADD CONSTRAINT "ration_lab_reports_knowledgeReportId_fkey" FOREIGN KEY ("knowledgeReportId") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_followup_checkins" ADD CONSTRAINT "ration_followup_checkins_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "ration_samples"("id") ON DELETE CASCADE ON UPDATE CASCADE;
