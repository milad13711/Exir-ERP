-- مکاتبات سازمانی (دبیرخانه) — فقط افزایشی؛ بدون مقدار enum جدید و بدون OWNED BY/تغییر مالکیت.

-- CreateTable
CREATE TABLE "corr_letter_categories" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_letter_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_numbering_schemes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "resetPolicy" TEXT NOT NULL DEFAULT 'YEARLY',
    "startAt" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corr_numbering_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_number_counters" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_number_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_archive_folders" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_archive_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_letters" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL DEFAULT '',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "letterNumber" TEXT,
    "numberingSchemeId" TEXT,
    "numberPeriodKey" TEXT,
    "numberSeq" INTEGER,
    "letterDate" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "externalNumber" TEXT,
    "externalDate" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "deliveryMethod" TEXT,
    "senderOrgName" TEXT,
    "senderName" TEXT,
    "senderContactId" TEXT,
    "senderKey" TEXT,
    "pageCount" INTEGER,
    "attachmentsText" TEXT,
    "registeredAt" TIMESTAMP(3),
    "registeredByUserId" TEXT,
    "registeredByName" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "recipientsText" TEXT NOT NULL DEFAULT '',
    "ccNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "categoryId" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "confidentiality" TEXT NOT NULL DEFAULT 'NORMAL',
    "responseDueAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "replyToLetterId" TEXT,
    "correctionOfLetterId" TEXT,
    "relatedContactId" TEXT,
    "relatedProjectId" TEXT,
    "relatedContractId" TEXT,
    "relatedInvoiceId" TEXT,
    "letterheadId" TEXT,
    "templateId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdByUserId" TEXT,
    "createdByName" TEXT,
    "ownerUserId" TEXT,
    "signerUserId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signedByUserId" TEXT,
    "signerName" TEXT,
    "signerTitle" TEXT,
    "lastReturnNote" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedByUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archiveFolderId" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "pdfSnapshotAttachmentId" TEXT,
    "pdfSnapshotSha256" TEXT,
    "contentHash" TEXT,
    "verifyTokenHash" TEXT,
    "revisionNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corr_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_referrals" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "fromName" TEXT,
    "toUserId" TEXT NOT NULL,
    "toName" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'ACTION',
    "instruction" TEXT NOT NULL DEFAULT '',
    "dueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "seenAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "response" TEXT,
    "parentReferralId" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "dueNotifiedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_paraphs" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorTitle" TEXT,
    "text" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_paraphs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_letter_reviews" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "reviewerName" TEXT,
    "order" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_letter_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_events" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_revisions" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "reason" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actorUserId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_participants" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corr_deliveries" (
    "id" TEXT NOT NULL,
    "letterId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "recipientName" TEXT,
    "sentAt" TIMESTAMP(3),
    "trackingCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "receiptReceivedAt" TIMESTAMP(3),
    "receiptAttachmentId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corr_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "corr_letter_categories_code_key" ON "corr_letter_categories"("code");

-- CreateIndex
CREATE INDEX "corr_letter_categories_parentId_idx" ON "corr_letter_categories"("parentId");

-- CreateIndex
CREATE INDEX "corr_numbering_schemes_type_isDefault_isActive_idx" ON "corr_numbering_schemes"("type", "isDefault", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "corr_number_counters_schemeId_periodKey_key" ON "corr_number_counters"("schemeId", "periodKey");

-- CreateIndex
CREATE INDEX "corr_archive_folders_parentId_idx" ON "corr_archive_folders"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "corr_letters_verifyTokenHash_key" ON "corr_letters"("verifyTokenHash");

-- CreateIndex
CREATE INDEX "corr_letters_type_status_createdAt_idx" ON "corr_letters"("type", "status", "createdAt");

-- CreateIndex
CREATE INDEX "corr_letters_status_createdAt_idx" ON "corr_letters"("status", "createdAt");

-- CreateIndex
CREATE INDEX "corr_letters_createdByUserId_idx" ON "corr_letters"("createdByUserId");

-- CreateIndex
CREATE INDEX "corr_letters_ownerUserId_idx" ON "corr_letters"("ownerUserId");

-- CreateIndex
CREATE INDEX "corr_letters_signerUserId_status_idx" ON "corr_letters"("signerUserId", "status");

-- CreateIndex
CREATE INDEX "corr_letters_categoryId_idx" ON "corr_letters"("categoryId");

-- CreateIndex
CREATE INDEX "corr_letters_replyToLetterId_idx" ON "corr_letters"("replyToLetterId");

-- CreateIndex
CREATE INDEX "corr_letters_senderKey_externalNumber_idx" ON "corr_letters"("senderKey", "externalNumber");

-- CreateIndex
CREATE INDEX "corr_letters_letterDate_idx" ON "corr_letters"("letterDate");

-- CreateIndex
CREATE INDEX "corr_letters_archivedAt_idx" ON "corr_letters"("archivedAt");

-- CreateIndex
CREATE INDEX "corr_letters_responseDueAt_idx" ON "corr_letters"("responseDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "corr_letters_type_letterNumber_key" ON "corr_letters"("type", "letterNumber");

-- CreateIndex
CREATE INDEX "corr_referrals_letterId_seq_idx" ON "corr_referrals"("letterId", "seq");

-- CreateIndex
CREATE INDEX "corr_referrals_toUserId_status_idx" ON "corr_referrals"("toUserId", "status");

-- CreateIndex
CREATE INDEX "corr_referrals_status_dueAt_idx" ON "corr_referrals"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "corr_paraphs_letterId_order_key" ON "corr_paraphs"("letterId", "order");

-- CreateIndex
CREATE INDEX "corr_letter_reviews_reviewerUserId_status_idx" ON "corr_letter_reviews"("reviewerUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "corr_letter_reviews_letterId_reviewerUserId_key" ON "corr_letter_reviews"("letterId", "reviewerUserId");

-- CreateIndex
CREATE INDEX "corr_events_letterId_createdAt_idx" ON "corr_events"("letterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "corr_revisions_letterId_revisionNo_key" ON "corr_revisions"("letterId", "revisionNo");

-- CreateIndex
CREATE INDEX "corr_participants_userId_letterId_idx" ON "corr_participants"("userId", "letterId");

-- CreateIndex
CREATE UNIQUE INDEX "corr_participants_letterId_userId_role_key" ON "corr_participants"("letterId", "userId", "role");

-- CreateIndex
CREATE INDEX "corr_deliveries_letterId_idx" ON "corr_deliveries"("letterId");

-- AddForeignKey
ALTER TABLE "corr_letter_categories" ADD CONSTRAINT "corr_letter_categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "corr_letter_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_number_counters" ADD CONSTRAINT "corr_number_counters_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "corr_numbering_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_letters" ADD CONSTRAINT "corr_letters_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "corr_letter_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_referrals" ADD CONSTRAINT "corr_referrals_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "corr_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_paraphs" ADD CONSTRAINT "corr_paraphs_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "corr_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_letter_reviews" ADD CONSTRAINT "corr_letter_reviews_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "corr_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_events" ADD CONSTRAINT "corr_events_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "corr_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_revisions" ADD CONSTRAINT "corr_revisions_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "corr_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_participants" ADD CONSTRAINT "corr_participants_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "corr_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corr_deliveries" ADD CONSTRAINT "corr_deliveries_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "corr_letters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
