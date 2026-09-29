-- Automation: generic once-per-day-per-entity dedup for date-based triggers (e.g. birthdays).
CREATE TABLE "automation_trigger_firings" (
    "id" TEXT NOT NULL,
    "triggerCode" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "firedOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_trigger_firings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_trigger_firings_triggerCode_entityId_firedOn_key" ON "automation_trigger_firings"("triggerCode", "entityId", "firedOn");
