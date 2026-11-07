-- CreateTable
CREATE TABLE "document_referrals" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT,
    "fromUserId" TEXT,
    "toUserId" TEXT NOT NULL,
    "note" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "acceptedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolvedNote" TEXT,
    "idempotencyKey" TEXT,
    "dueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_referrals_idempotencyKey_key" ON "document_referrals"("idempotencyKey");
CREATE INDEX "document_referrals_entityType_entityId_status_idx" ON "document_referrals"("entityType", "entityId", "status");
CREATE INDEX "document_referrals_toUserId_status_idx" ON "document_referrals"("toUserId", "status");
CREATE INDEX "document_referrals_fromUserId_idx" ON "document_referrals"("fromUserId");
CREATE INDEX "document_referrals_status_dueAt_idx" ON "document_referrals"("status", "dueAt");
