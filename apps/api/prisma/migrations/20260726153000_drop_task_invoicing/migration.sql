-- Invoicing leaves the task chain (2026-07-26): billing is Finance-module work,
-- not a task step. Completed tasks are closed directly by whoever runs the
-- project. This drops the INVOICED value from the TaskStatus enum.
--
-- GUARDED: refuses to run while any task or history row still references
-- INVOICED — resolve those first (close the tasks), then re-run.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tasks" WHERE "status" = 'INVOICED') THEN
    RAISE EXCEPTION 'Cannot drop INVOICED: tasks still hold this status. Close them first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_status_history"
    WHERE "fromStatus" = 'INVOICED' OR "toStatus" = 'INVOICED'
  ) THEN
    RAISE EXCEPTION 'Cannot drop INVOICED: task history references it.';
  END IF;
END $$;

-- Postgres cannot remove a value from an enum in place — rebuild it.
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
CREATE TYPE "TaskStatus" AS ENUM (
  'DRAFT', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW',
  'CLIENT_REVIEW', 'COMPLETED', 'CLOSED', 'CANCELLED'
);

ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::text::"TaskStatus";
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "task_status_history" ALTER COLUMN "fromStatus" TYPE "TaskStatus" USING "fromStatus"::text::"TaskStatus";
ALTER TABLE "task_status_history" ALTER COLUMN "toStatus" TYPE "TaskStatus" USING "toStatus"::text::"TaskStatus";

DROP TYPE "TaskStatus_old";
