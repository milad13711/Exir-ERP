-- Backfill for the task workflow rework (new enum values from the previous migration are usable here).
-- Legacy OPEN -> NEW, legacy DONE (meant "finished") -> APPROVED. Idempotent.
UPDATE "tasks" SET "status" = 'APPROVED', "approvedAt" = COALESCE("completedAt", "createdAt") WHERE "status" = 'DONE' AND "approvedAt" IS NULL AND "submittedAt" IS NULL;
UPDATE "tasks" SET "status" = 'NEW' WHERE "status" = 'OPEN';
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- Existing single assignee becomes one assignee row (assignedUserId is kept as the primary assignee).
INSERT INTO "task_assignees" ("id", "taskId", "userId", "createdAt")
SELECT gen_random_uuid()::text, t."id", t."assignedUserId", t."createdAt" FROM "tasks" t
WHERE t."assignedUserId" IS NOT NULL
ON CONFLICT ("taskId", "userId") DO NOTHING;

-- Timeline seed so old tasks have a history entry.
INSERT INTO "task_events" ("id", "taskId", "type", "toStatus", "note", "createdAt")
SELECT gen_random_uuid()::text, t."id", 'created', t."status", 'مهاجرت از نسخه‌ی قبلی', t."createdAt" FROM "tasks" t
WHERE NOT EXISTS (SELECT 1 FROM "task_events" e WHERE e."taskId" = t."id");
