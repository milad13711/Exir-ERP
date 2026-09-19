ALTER TYPE "ApplicantStage" ADD VALUE IF NOT EXISTS 'OFFER_SENT';
ALTER TYPE "ApplicantStage" ADD VALUE IF NOT EXISTS 'OFFER_DECLINED';
ALTER TYPE "ApplicantStage" ADD VALUE IF NOT EXISTS 'AWAITING_MANAGEMENT';
ALTER TYPE "JobOfferStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

ALTER TABLE "recruitment_offers"
  ADD COLUMN "candidateSignature" TEXT,
  ADD COLUMN "candidateRejectedAt" TIMESTAMP(3),
  ADD COLUMN "stampApplied" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "approval_requests" (
  "id" TEXT NOT NULL,
  "moduleCode" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "link" TEXT,
  "isOfficial" BOOLEAN NOT NULL DEFAULT false,
  "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedByUserId" TEXT,
  "assigneeUserId" TEXT,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "stampApplied" BOOLEAN NOT NULL DEFAULT false,
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_requests_status_createdAt_idx" ON "approval_requests"("status", "createdAt");
CREATE INDEX "approval_requests_entityType_entityId_idx" ON "approval_requests"("entityType", "entityId");
CREATE INDEX "approval_requests_assigneeUserId_status_idx" ON "approval_requests"("assigneeUserId", "status");
