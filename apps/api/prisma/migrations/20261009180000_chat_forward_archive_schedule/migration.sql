-- Chat (2026-10-09): forwarded messages, removing (archiving) a group, and
-- scheduled messages.

-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedById" UUID;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "forwarded" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "chat_scheduled_messages" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "messageId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "failedReason" TEXT,

    CONSTRAINT "chat_scheduled_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_scheduled_messages_sendAt_idx" ON "chat_scheduled_messages"("sendAt");

-- CreateIndex
CREATE INDEX "chat_scheduled_messages_authorId_roomId_idx" ON "chat_scheduled_messages"("authorId", "roomId");

-- AddForeignKey
ALTER TABLE "chat_scheduled_messages" ADD CONSTRAINT "chat_scheduled_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_scheduled_messages" ADD CONSTRAINT "chat_scheduled_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
