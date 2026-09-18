-- تاریخچه‌ی تماس تننت (ورودی/خروجی) — از وب‌هوک PBX و از originate ساخته
-- می‌شود؛ crmActivityId به یادداشت خودکار روی پروفایل مخاطب اشاره می‌کند.

CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ANSWERED', 'MISSED', 'NO_ANSWER', 'FAILED');

CREATE TABLE "call_logs" (
    "id" TEXT NOT NULL,
    "providerCallId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "fromNumber" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "contactId" TEXT,
    "userId" TEXT,
    "crmActivityId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "recordingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_logs_providerCallId_key" ON "call_logs"("providerCallId");
CREATE UNIQUE INDEX "call_logs_crmActivityId_key" ON "call_logs"("crmActivityId");
CREATE INDEX "call_logs_contactId_idx" ON "call_logs"("contactId");
CREATE INDEX "call_logs_userId_idx" ON "call_logs"("userId");
CREATE INDEX "call_logs_startedAt_idx" ON "call_logs"("startedAt");

ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_crmActivityId_fkey" FOREIGN KEY ("crmActivityId") REFERENCES "crm_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
