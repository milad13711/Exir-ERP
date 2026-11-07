-- وضعیت «دیده‌شده» اعلان‌های به‌روزرسانی ماژول — فقط افزایشی، بدون تغییر مالکیت.
CREATE TABLE IF NOT EXISTS "module_release_reads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "module_release_reads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "module_release_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "module_release_reads_userId_releaseId_key" ON "module_release_reads"("userId", "releaseId");
CREATE INDEX IF NOT EXISTS "module_release_reads_releaseId_idx" ON "module_release_reads"("releaseId");
