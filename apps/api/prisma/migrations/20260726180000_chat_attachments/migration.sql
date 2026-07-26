-- Chat attachments (2026-07-26): a file asset may hang off a chat message.
-- Null while the upload is still a draft — files are picked before the message
-- exists, and posting links them.
ALTER TABLE "file_assets" ADD COLUMN "chatMessageId" UUID;

CREATE INDEX "file_assets_chatMessageId_idx" ON "file_assets"("chatMessageId");

ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_chatMessageId_fkey"
    FOREIGN KEY ("chatMessageId") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
