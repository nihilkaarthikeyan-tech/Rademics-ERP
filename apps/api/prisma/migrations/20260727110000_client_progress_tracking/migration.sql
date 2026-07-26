-- Client progress tracking (2026-07-27): when did the client last see movement
-- on a task, and when did they last ask for a status update (cooldown).
ALTER TABLE "tasks" ADD COLUMN "lastClientUpdateAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "lastStatusRequestAt" TIMESTAMP(3);
