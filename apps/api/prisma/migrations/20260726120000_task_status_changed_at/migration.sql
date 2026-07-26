-- Track when a task entered its current status, so stalled handoffs (assigned
-- but never accepted) can be spotted, marked on the board, and chased daily.
ALTER TABLE "tasks" ADD COLUMN "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: the moment of the last recorded transition, else task creation.
UPDATE "tasks" t
SET "statusChangedAt" = COALESCE(
  (SELECT MAX(h."createdAt") FROM "task_status_history" h WHERE h."taskId" = t."id"),
  t."createdAt"
);
