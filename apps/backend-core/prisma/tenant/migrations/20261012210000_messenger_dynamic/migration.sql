-- پیام‌رسان پویا — additive: سنجاق/بایگانی شخصی گفتگو + شناسه‌ی کلاینت برای ارسال idempotent.
ALTER TABLE "messenger_members" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "messenger_members" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "messenger_messages" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "messenger_messages_senderId_clientId_key" ON "messenger_messages"("senderId", "clientId");
