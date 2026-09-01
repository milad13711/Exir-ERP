-- CreateTable
CREATE TABLE "generic_attachments" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generic_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "generic_attachments_entityType_entityId_idx" ON "generic_attachments"("entityType", "entityId");

ALTER TABLE "generic_attachments" ADD CONSTRAINT "generic_attachments_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
