-- Chat upgrades (2026-07-27): emoji reactions, pinned announcements, message edits.

ALTER TABLE "chat_messages" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN "pinnedById" UUID;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_pinnedById_fkey"
    FOREIGN KEY ("pinnedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "chat_messages_pinnedAt_idx" ON "chat_messages"("pinnedAt");

CREATE TABLE "chat_reactions" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_reactions_messageId_userId_emoji_key" ON "chat_reactions"("messageId", "userId", "emoji");

ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
