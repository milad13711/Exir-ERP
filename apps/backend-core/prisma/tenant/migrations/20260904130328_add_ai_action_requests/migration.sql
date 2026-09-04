-- CreateTable
CREATE TABLE "ai_action_requests" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "error" TEXT,
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "ai_action_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_action_requests_status_createdAt_idx" ON "ai_action_requests"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_action_requests" ADD CONSTRAINT "ai_action_requests_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
