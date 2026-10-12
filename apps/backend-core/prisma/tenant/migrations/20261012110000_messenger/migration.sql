-- پیام‌رسان داخلی — additive. رسانه‌ها فقط ۲۴ ساعت (متادیتا جدا از بایت‌ها تا پاکسازی ارزان باشد).

CREATE TYPE "MessengerConversationType" AS ENUM ('DIRECT', 'GROUP', 'SAVED');
CREATE TYPE "MessengerMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "MessengerMessageKind" AS ENUM ('TEXT', 'MEDIA', 'SYSTEM');
CREATE TYPE "MessengerMediaKind" AS ENUM ('IMAGE', 'FILE', 'VIDEO');

CREATE TABLE "messenger_conversations" (
  "id" TEXT NOT NULL,
  "type" "MessengerConversationType" NOT NULL,
  "title" TEXT,
  "directKey" TEXT,
  "createdById" TEXT NOT NULL,
  "lastSeq" INTEGER NOT NULL DEFAULT 0,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_conversations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "messenger_conversations_directKey_key" ON "messenger_conversations"("directKey");
CREATE INDEX "messenger_conversations_lastMessageAt_idx" ON "messenger_conversations"("lastMessageAt");

CREATE TABLE "messenger_members" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "MessengerMemberRole" NOT NULL DEFAULT 'MEMBER',
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "lastReadSeq" INTEGER NOT NULL DEFAULT 0,
  "lastDeliveredSeq" INTEGER NOT NULL DEFAULT 0,
  "visibleFromSeq" INTEGER NOT NULL DEFAULT 0,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messenger_members_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "messenger_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "messenger_members_conversationId_userId_key" ON "messenger_members"("conversationId", "userId");
CREATE INDEX "messenger_members_userId_idx" ON "messenger_members"("userId");

CREATE TABLE "messenger_media" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "uploaderId" TEXT NOT NULL,
  "kind" "MessengerMediaKind" NOT NULL,
  "mime" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "purgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_media_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "messenger_media_expiresAt_purgedAt_idx" ON "messenger_media"("expiresAt", "purgedAt");
CREATE INDEX "messenger_media_uploaderId_createdAt_idx" ON "messenger_media"("uploaderId", "createdAt");

CREATE TABLE "messenger_media_blobs" (
  "mediaId" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  CONSTRAINT "messenger_media_blobs_pkey" PRIMARY KEY ("mediaId"),
  CONSTRAINT "messenger_media_blobs_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "messenger_media"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "messenger_messages" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "senderId" TEXT NOT NULL,
  "kind" "MessengerMessageKind" NOT NULL DEFAULT 'TEXT',
  "text" TEXT,
  "replyToId" TEXT,
  "forwardedFromName" TEXT,
  "forwardedFromUserId" TEXT,
  "mediaId" TEXT,
  "mentionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "editedAt" TIMESTAMP(3),
  "deletedForAllAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messenger_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "messenger_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "messenger_messages_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "messenger_media"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "messenger_messages_conversationId_seq_key" ON "messenger_messages"("conversationId", "seq");
CREATE INDEX "messenger_messages_conversationId_createdAt_idx" ON "messenger_messages"("conversationId", "createdAt");
CREATE INDEX "messenger_messages_mediaId_idx" ON "messenger_messages"("mediaId");

CREATE TABLE "messenger_message_hides" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_message_hides_pkey" PRIMARY KEY ("messageId", "userId"),
  CONSTRAINT "messenger_message_hides_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messenger_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "messenger_message_hides_userId_idx" ON "messenger_message_hides"("userId");

CREATE TABLE "messenger_reactions" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_reactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messenger_reactions_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messenger_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "messenger_reactions_messageId_userId_emoji_key" ON "messenger_reactions"("messageId", "userId", "emoji");
CREATE INDEX "messenger_reactions_messageId_idx" ON "messenger_reactions"("messageId");

CREATE TABLE "messenger_pins" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "pinnedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "messenger_pins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "messenger_pins_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "messenger_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "messenger_pins_conversationId_messageId_key" ON "messenger_pins"("conversationId", "messageId");

CREATE TABLE "messenger_presence" (
  "userId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "messenger_presence_pkey" PRIMARY KEY ("userId")
);
