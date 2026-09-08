-- CreateEnum
CREATE TYPE "MentoringPricingModel" AS ENUM ('HOURLY', 'PACKAGE', 'PROJECT_BASED', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "MentoringEngagementStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MentoringSessionMode" AS ENUM ('ONLINE', 'PHONE', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "MentoringSessionStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "MentoringGoalType" AS ENUM ('QUANTITATIVE', 'QUALITATIVE');

-- CreateEnum
CREATE TYPE "MentoringGoalStatus" AS ENUM ('IN_PROGRESS', 'ACHIEVED', 'MISSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "mentoring_engagements" (
    "id" TEXT NOT NULL,
    "engagementNo" SERIAL NOT NULL,
    "contactId" TEXT NOT NULL,
    "advisorUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pricingModel" "MentoringPricingModel" NOT NULL DEFAULT 'HOURLY',
    "hourlyRate" INTEGER,
    "packageSessionsCount" INTEGER,
    "packagePrice" INTEGER,
    "subscriptionMonthlyPrice" INTEGER,
    "status" "MentoringEngagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "contractId" TEXT,
    "projectId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mentoring_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentoring_sessions" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "mode" "MentoringSessionMode" NOT NULL DEFAULT 'ONLINE',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "status" "MentoringSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "location" TEXT,
    "minutesNote" TEXT,
    "invoiceId" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "surveySentAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mentoring_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentoring_session_surveys" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "publicToken" TEXT NOT NULL,
    "rating" INTEGER,
    "note" TEXT,
    "sentAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentoring_session_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentoring_goals" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MentoringGoalType" NOT NULL DEFAULT 'QUALITATIVE',
    "unit" TEXT,
    "baselineValue" DOUBLE PRECISION,
    "targetValue" DOUBLE PRECISION,
    "targetDate" TIMESTAMP(3),
    "status" "MentoringGoalStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mentoring_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentoring_goal_check_ins" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "sessionId" TEXT,
    "value" DOUBLE PRECISION,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentoring_goal_check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mentoring_engagements_engagementNo_key" ON "mentoring_engagements"("engagementNo");

-- CreateIndex
CREATE INDEX "mentoring_engagements_contactId_idx" ON "mentoring_engagements"("contactId");

-- CreateIndex
CREATE INDEX "mentoring_engagements_advisorUserId_idx" ON "mentoring_engagements"("advisorUserId");

-- CreateIndex
CREATE INDEX "mentoring_engagements_status_idx" ON "mentoring_engagements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "mentoring_sessions_appointmentId_key" ON "mentoring_sessions"("appointmentId");

-- CreateIndex
CREATE INDEX "mentoring_sessions_engagementId_idx" ON "mentoring_sessions"("engagementId");

-- CreateIndex
CREATE INDEX "mentoring_sessions_scheduledAt_idx" ON "mentoring_sessions"("scheduledAt");

-- CreateIndex
CREATE INDEX "mentoring_sessions_status_idx" ON "mentoring_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "mentoring_session_surveys_sessionId_key" ON "mentoring_session_surveys"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "mentoring_session_surveys_publicToken_key" ON "mentoring_session_surveys"("publicToken");

-- CreateIndex
CREATE INDEX "mentoring_goals_engagementId_idx" ON "mentoring_goals"("engagementId");

-- CreateIndex
CREATE INDEX "mentoring_goal_check_ins_goalId_idx" ON "mentoring_goal_check_ins"("goalId");

-- AddForeignKey
ALTER TABLE "mentoring_engagements" ADD CONSTRAINT "mentoring_engagements_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_engagements" ADD CONSTRAINT "mentoring_engagements_advisorUserId_fkey" FOREIGN KEY ("advisorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_engagements" ADD CONSTRAINT "mentoring_engagements_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_engagements" ADD CONSTRAINT "mentoring_engagements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_engagements" ADD CONSTRAINT "mentoring_engagements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_sessions" ADD CONSTRAINT "mentoring_sessions_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "mentoring_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_sessions" ADD CONSTRAINT "mentoring_sessions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_sessions" ADD CONSTRAINT "mentoring_sessions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "sales_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_sessions" ADD CONSTRAINT "mentoring_sessions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_session_surveys" ADD CONSTRAINT "mentoring_session_surveys_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "mentoring_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_goals" ADD CONSTRAINT "mentoring_goals_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "mentoring_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_goal_check_ins" ADD CONSTRAINT "mentoring_goal_check_ins_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "mentoring_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentoring_goal_check_ins" ADD CONSTRAINT "mentoring_goal_check_ins_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "mentoring_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
