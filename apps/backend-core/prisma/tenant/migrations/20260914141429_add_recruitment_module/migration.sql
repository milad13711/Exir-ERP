-- CreateEnum
CREATE TYPE "JobEmploymentType" AS ENUM ('INTERN', 'PROJECT_BASED', 'PART_TIME', 'FULL_TIME');

-- CreateEnum
CREATE TYPE "JobPostingStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicantStage" AS ENUM ('NEW', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'SPECIALIST_APPROVED', 'SPECIALIST_REJECTED', 'MANAGEMENT_APPROVED', 'MANAGEMENT_REJECTED', 'HIRED');

-- CreateEnum
CREATE TYPE "InterviewStatus" AS ENUM ('SCHEDULED', 'DONE', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "JobOfferStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'SIGNED');

-- AlterTable
ALTER TABLE "hr_employees" ADD COLUMN     "terminatedAt" TIMESTAMP(3),
ADD COLUMN     "terminationReason" TEXT;

-- CreateTable
CREATE TABLE "recruitment_job_postings" (
    "id" TEXT NOT NULL,
    "postingNo" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "jobField" TEXT NOT NULL,
    "employmentType" "JobEmploymentType" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "publishChannel" TEXT,
    "publishBudget" INTEGER,
    "description" TEXT,
    "status" "JobPostingStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_applicants" (
    "id" TEXT NOT NULL,
    "jobPostingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "educationField" TEXT,
    "skillTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resumeFile" TEXT,
    "stage" "ApplicantStage" NOT NULL DEFAULT 'NEW',
    "specialistDecisionReason" TEXT,
    "specialistDecisionAt" TIMESTAMP(3),
    "specialistUserId" TEXT,
    "managementDecisionReason" TEXT,
    "managementDecisionAt" TIMESTAMP(3),
    "managementUserId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_applicants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_interviews" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "interviewerUserId" TEXT,
    "status" "InterviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "overallNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_interviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_interview_scores" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "criterion" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "recruitment_interview_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recruitment_offers" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "jobDescription" TEXT NOT NULL,
    "collaborationType" TEXT NOT NULL,
    "workingHours" TEXT,
    "salary" INTEGER NOT NULL,
    "benefits" TEXT,
    "durationMonths" INTEGER,
    "startDate" TIMESTAMP(3),
    "status" "JobOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "publicToken" TEXT NOT NULL,
    "candidateAcceptedAt" TIMESTAMP(3),
    "signedByUserId" TEXT,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recruitment_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_job_postings_postingNo_key" ON "recruitment_job_postings"("postingNo");

-- CreateIndex
CREATE INDEX "recruitment_job_postings_status_idx" ON "recruitment_job_postings"("status");

-- CreateIndex
CREATE INDEX "recruitment_applicants_jobPostingId_idx" ON "recruitment_applicants"("jobPostingId");

-- CreateIndex
CREATE INDEX "recruitment_applicants_stage_idx" ON "recruitment_applicants"("stage");

-- CreateIndex
CREATE INDEX "recruitment_interviews_applicantId_idx" ON "recruitment_interviews"("applicantId");

-- CreateIndex
CREATE INDEX "recruitment_interviews_scheduledAt_idx" ON "recruitment_interviews"("scheduledAt");

-- CreateIndex
CREATE INDEX "recruitment_interview_scores_interviewId_idx" ON "recruitment_interview_scores"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_offers_applicantId_key" ON "recruitment_offers"("applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "recruitment_offers_publicToken_key" ON "recruitment_offers"("publicToken");

-- AddForeignKey
ALTER TABLE "recruitment_job_postings" ADD CONSTRAINT "recruitment_job_postings_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_applicants" ADD CONSTRAINT "recruitment_applicants_jobPostingId_fkey" FOREIGN KEY ("jobPostingId") REFERENCES "recruitment_job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_applicants" ADD CONSTRAINT "recruitment_applicants_specialistUserId_fkey" FOREIGN KEY ("specialistUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_applicants" ADD CONSTRAINT "recruitment_applicants_managementUserId_fkey" FOREIGN KEY ("managementUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_applicants" ADD CONSTRAINT "recruitment_applicants_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_interviews" ADD CONSTRAINT "recruitment_interviews_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "recruitment_applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_interviews" ADD CONSTRAINT "recruitment_interviews_interviewerUserId_fkey" FOREIGN KEY ("interviewerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_interview_scores" ADD CONSTRAINT "recruitment_interview_scores_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "recruitment_interviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_offers" ADD CONSTRAINT "recruitment_offers_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "recruitment_applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recruitment_offers" ADD CONSTRAINT "recruitment_offers_signedByUserId_fkey" FOREIGN KEY ("signedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
