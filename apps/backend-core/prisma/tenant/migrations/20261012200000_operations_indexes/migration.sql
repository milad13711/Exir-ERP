-- داشبورد عملیات — فقط ایندکس‌های افزایشی (بدون تغییر ساختار/مالکیت).
CREATE INDEX IF NOT EXISTS "tasks_createdAt_idx" ON "tasks"("createdAt");
CREATE INDEX IF NOT EXISTS "tasks_completedAt_idx" ON "tasks"("completedAt");
CREATE INDEX IF NOT EXISTS "task_events_createdAt_idx" ON "task_events"("createdAt");
CREATE INDEX IF NOT EXISTS "task_events_actorUserId_createdAt_idx" ON "task_events"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "task_extension_requests_status_idx" ON "task_extension_requests"("status");
