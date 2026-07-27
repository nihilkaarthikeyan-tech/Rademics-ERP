-- Deadline sweep (2026-07-27): once-only stamps for the 24h-warning and
-- missed-deadline notifications (Spec §5.12).

ALTER TABLE "tasks" ADD COLUMN "deadlineSoonNotifiedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "deadlineMissedNotifiedAt" TIMESTAMP(3);
