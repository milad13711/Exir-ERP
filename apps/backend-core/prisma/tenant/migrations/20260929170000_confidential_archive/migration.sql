-- CreateEnum
CREATE TYPE "ConfidentialDocumentCategory" AS ENUM ('PASSWORD', 'TECHNICAL_KNOWLEDGE', 'FORMULATION', 'CONFIDENTIAL_CONTRACT', 'SYSTEM_LOG', 'OTHER');

-- CreateTable
CREATE TABLE "confidential_documents" (
    "id"              TEXT NOT NULL,
    "title"           TEXT NOT NULL,
    "category"        "ConfidentialDocumentCategory" NOT NULL,
    "content"         TEXT,
    "fileName"        TEXT,
    "fileData"        TEXT,
    "createdByUserId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" TEXT,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "confidential_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "confidential_documents_category_idx" ON "confidential_documents"("category");
CREATE INDEX "confidential_documents_createdAt_idx" ON "confidential_documents"("createdAt");

ALTER TABLE "confidential_documents" ADD CONSTRAINT "confidential_documents_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "confidential_documents" ADD CONSTRAINT "confidential_documents_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "confidential_archive_access" (
    "id"              TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "canEdit"         BOOLEAN NOT NULL DEFAULT false,
    "grantedByUserId" TEXT,
    "grantedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "confidential_archive_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "confidential_archive_access_userId_key" ON "confidential_archive_access"("userId");

ALTER TABLE "confidential_archive_access" ADD CONSTRAINT "confidential_archive_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "confidential_archive_access" ADD CONSTRAINT "confidential_archive_access_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
