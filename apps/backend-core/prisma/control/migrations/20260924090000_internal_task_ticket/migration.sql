ALTER TABLE "internal_tasks" ADD COLUMN "ticketId" TEXT;

CREATE INDEX "internal_tasks_ticketId_idx" ON "internal_tasks"("ticketId");

ALTER TABLE "internal_tasks" ADD CONSTRAINT "internal_tasks_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
