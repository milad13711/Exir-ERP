-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "important" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN "toastEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "reminderAfterHours" INTEGER NOT NULL DEFAULT 4;

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_important_idx" ON "notifications"("userId", "readAt", "important");
