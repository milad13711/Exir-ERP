CREATE TABLE "sms_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "source" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sms_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sms_logs_tenantId_idx" ON "sms_logs"("tenantId");

CREATE INDEX "sms_logs_createdAt_idx" ON "sms_logs"("createdAt");

CREATE INDEX "sms_logs_success_idx" ON "sms_logs"("success");

ALTER TABLE "sms_logs" ADD CONSTRAINT "sms_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
