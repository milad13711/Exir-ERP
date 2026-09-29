-- AlterTable
ALTER TABLE "crm_contacts" ADD COLUMN "birthDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "dashboard_reminders" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_reminders_date_idx" ON "dashboard_reminders"("date");

-- AddForeignKey
ALTER TABLE "dashboard_reminders" ADD CONSTRAINT "dashboard_reminders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
