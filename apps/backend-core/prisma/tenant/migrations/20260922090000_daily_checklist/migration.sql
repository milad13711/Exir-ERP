CREATE TABLE "daily_checklist_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "taskId" TEXT,
    "createdByUserId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_checklist_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "daily_checklist_items_taskId_key" ON "daily_checklist_items"("taskId");

CREATE INDEX "daily_checklist_items_userId_date_idx" ON "daily_checklist_items"("userId", "date");

ALTER TABLE "daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "daily_checklist_items" ADD CONSTRAINT "daily_checklist_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
