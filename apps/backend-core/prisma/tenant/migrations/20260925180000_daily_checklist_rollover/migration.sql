ALTER TABLE "daily_checklist_items" ADD COLUMN "carriedOver" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "daily_checklist_day_closes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reportId" TEXT,
    "rolledOver" BOOLEAN NOT NULL DEFAULT false,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_checklist_day_closes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_checklist_day_closes_userId_date_key" ON "daily_checklist_day_closes"("userId", "date");

ALTER TABLE "daily_checklist_day_closes" ADD CONSTRAINT "daily_checklist_day_closes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
