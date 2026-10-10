-- پیامک وضعیت/پیشرفت پروژه به مشتری — additive

ALTER TABLE "projects" ADD COLUMN "notifyCustomerBySms" BOOLEAN;

CREATE TABLE "project_sms_logs" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "stageId" TEXT,
  "event" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "error" TEXT,
  "userId" TEXT,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_sms_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_sms_logs_dedupeKey_key" ON "project_sms_logs"("dedupeKey");
CREATE INDEX "project_sms_logs_projectId_createdAt_idx" ON "project_sms_logs"("projectId", "createdAt");
CREATE INDEX "project_sms_logs_createdAt_idx" ON "project_sms_logs"("createdAt");
ALTER TABLE "project_sms_logs" ADD CONSTRAINT "project_sms_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
