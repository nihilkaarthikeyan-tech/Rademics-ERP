-- Notice read receipts + optional acknowledgment, and chat message soft-delete
-- for moderation (2026-07-27).

ALTER TABLE "announcements" ADD COLUMN "requiresAck" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "announcement_reads" (
    "announcementId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcementId","userId")
);

ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chat message soft-delete: the row stays (attributed, audited); the API
-- blanks body/files for callers once deletedAt is set.
ALTER TABLE "chat_messages" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "chat_messages" ADD COLUMN "deletedById" UUID;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
