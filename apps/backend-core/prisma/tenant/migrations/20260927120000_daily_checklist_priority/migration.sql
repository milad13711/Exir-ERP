-- CreateEnum
CREATE TYPE "ChecklistItemPriority" AS ENUM ('URGENT', 'MEDIUM', 'NORMAL');

-- AlterTable
ALTER TABLE "daily_checklist_items" ADD COLUMN "priority" "ChecklistItemPriority" NOT NULL DEFAULT 'NORMAL';
