-- Task workflow rework (additive). Old columns (assignedUserId, status OPEN/DONE) are kept; data is backfilled in the next migration
-- (new enum values cannot be used in the same transaction that adds them).

ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'NEW';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'SEEN';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'HAS_PROBLEM';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'RETURNED_FOR_FIX';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

CREATE TYPE "TaskRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');
CREATE TYPE "TaskReviewStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'RETURNED');
CREATE TYPE "TaskExtensionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- Atomic per-tenant number sequence; existing rows are numbered by creation order.
CREATE SEQUENCE "tasks_number_seq";
ALTER TABLE "tasks" ADD COLUMN "number" INTEGER;
UPDATE "tasks" t SET "number" = n.rn FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS rn FROM "tasks") n WHERE t."id" = n."id";
SELECT setval('"tasks_number_seq"', COALESCE((SELECT MAX("number") FROM "tasks"), 0) + 1, false);
ALTER TABLE "tasks" ALTER COLUMN "number" SET DEFAULT nextval('"tasks_number_seq"');
ALTER TABLE "tasks" ALTER COLUMN "number" SET NOT NULL;
ALTER SEQUENCE "tasks_number_seq" OWNED BY "tasks"."number";
CREATE UNIQUE INDEX "tasks_number_key" ON "tasks"("number");

ALTER TABLE "tasks"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "startAt" TIMESTAMP(3),
  ADD COLUMN "sendAt" TIMESTAMP(3),
  ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "reminderOffsetsMin" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "remindersSentMin" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "overdueNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "expiredFrom" "TaskStatus",
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "recurrence" "TaskRecurrence" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "recurrenceEndAt" TIMESTAMP(3),
  ADD COLUMN "nextRecurAt" TIMESTAMP(3),
  ADD COLUMN "recurrenceParentId" TEXT;

CREATE INDEX "tasks_status_dueAt_idx" ON "tasks"("status", "dueAt");
CREATE INDEX "tasks_createdByUserId_idx" ON "tasks"("createdByUserId");
CREATE INDEX "tasks_isPublished_sendAt_idx" ON "tasks"("isPublished", "sendAt");
CREATE INDEX "tasks_nextRecurAt_idx" ON "tasks"("nextRecurAt");

CREATE TABLE "task_assignees" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "task_assignees_taskId_userId_key" ON "task_assignees"("taskId", "userId");
CREATE INDEX "task_assignees_userId_idx" ON "task_assignees"("userId");
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_events" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorUserId" TEXT,
  "fromStatus" "TaskStatus",
  "toStatus" "TaskStatus",
  "note" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_events_taskId_createdAt_idx" ON "task_events"("taskId", "createdAt");
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_comments" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "parentId" TEXT,
  "authorUserId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "isProblem" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "task_comments"("taskId", "createdAt");
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_results" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "authorUserId" TEXT NOT NULL,
  "text" TEXT,
  "status" "TaskReviewStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reviewNote" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_results_taskId_createdAt_idx" ON "task_results"("taskId", "createdAt");
ALTER TABLE "task_results" ADD CONSTRAINT "task_results_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_extension_requests" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "proposedDueAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "status" "TaskExtensionStatus" NOT NULL DEFAULT 'PENDING',
  "decidedByUserId" TEXT,
  "decisionNote" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_extension_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "task_extension_requests_taskId_createdAt_idx" ON "task_extension_requests"("taskId", "createdAt");
ALTER TABLE "task_extension_requests" ADD CONSTRAINT "task_extension_requests_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
