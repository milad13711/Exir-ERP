-- ساعت‌های غیرفعال رزرو نوبت — additive، بدون تغییر ساختار جداول موجود.
CREATE TABLE "staff_time_blocks" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "startMinute" INTEGER,
  "endMinute" INTEGER,
  "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "reason" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_time_blocks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_time_blocks_userId_startDate_endDate_idx" ON "staff_time_blocks"("userId", "startDate", "endDate");

CREATE TABLE "staff_booking_preferences" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "blockFromTasks" BOOLEAN NOT NULL DEFAULT true,
  "blockFromCalendar" BOOLEAN NOT NULL DEFAULT true,
  "blockFromLeave" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_booking_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "staff_booking_preferences_userId_key" ON "staff_booking_preferences"("userId");
