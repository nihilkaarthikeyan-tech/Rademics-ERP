-- Chat (2026-10-09): quoted replies and muting a conversation.

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "replyToId" UUID;

-- AlterTable
ALTER TABLE "chat_room_members" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "chat_read_state" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
