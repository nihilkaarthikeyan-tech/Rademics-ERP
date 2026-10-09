-- Chat rooms (2026-10-09): the single company room becomes one room among
-- groups (created by HR / Super Admin) and one-to-one conversations.
-- Ordered so existing messages are never orphaned: the company room is
-- created first, every existing message is moved into it, and only then is
-- the room column made required.

-- CreateEnum
CREATE TYPE "ChatRoomKind" AS ENUM ('COMPANY', 'GROUP', 'DIRECT');

-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" UUID NOT NULL,
    "kind" "ChatRoomKind" NOT NULL,
    "name" TEXT,
    "directKey" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_members" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_room_members_pkey" PRIMARY KEY ("roomId","userId")
);

-- The company room, at a fixed id the API knows (COMPANY_ROOM_ID).
INSERT INTO "chat_rooms" ("id", "kind", "name", "createdAt", "lastMessageAt")
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'COMPANY',
  'Company',
  CURRENT_TIMESTAMP,
  COALESCE((SELECT MAX("createdAt") FROM "chat_messages"), CURRENT_TIMESTAMP)
);

-- Every existing message belongs to the company room.
ALTER TABLE "chat_messages" ADD COLUMN "roomId" UUID;
UPDATE "chat_messages" SET "roomId" = '00000000-0000-4000-8000-000000000001' WHERE "roomId" IS NULL;
ALTER TABLE "chat_messages" ALTER COLUMN "roomId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_directKey_key" ON "chat_rooms"("directKey");

-- CreateIndex
CREATE INDEX "chat_rooms_kind_idx" ON "chat_rooms"("kind");

-- CreateIndex
CREATE INDEX "chat_room_members_userId_idx" ON "chat_room_members"("userId");

-- CreateIndex
CREATE INDEX "chat_messages_roomId_createdAt_idx" ON "chat_messages"("roomId", "createdAt");

-- AddForeignKey
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_room_members" ADD CONSTRAINT "chat_room_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
