-- Client-approval power removed (2026-07-27): a client can only ever view
-- progress and ask for a status update — no more approve / request-revision,
-- no more Viewer/Approver distinction. This drops CLIENT_REVIEW from
-- TaskStatus and the level column + ClientAccessLevel enum from
-- ClientProjectAccess.
--
-- GUARDED: refuses to run while any task still sits in CLIENT_REVIEW —
-- resolve those first (the app no longer offers a way to leave that status,
-- so they'd need a direct one-off UPDATE before this can proceed).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "tasks" WHERE "status" = 'CLIENT_REVIEW') THEN
    RAISE EXCEPTION 'Cannot drop CLIENT_REVIEW: tasks still hold this status. Move them to COMPLETED first.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "task_status_history"
    WHERE "fromStatus" = 'CLIENT_REVIEW' OR "toStatus" = 'CLIENT_REVIEW'
  ) THEN
    RAISE EXCEPTION 'Cannot drop CLIENT_REVIEW: task history references it.';
  END IF;
END $$;

-- Postgres cannot remove a value from an enum in place — rebuild it.
ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";
CREATE TYPE "TaskStatus" AS ENUM (
  'DRAFT', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW',
  'COMPLETED', 'CLOSED', 'CANCELLED'
);

ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "tasks" ALTER COLUMN "status" TYPE "TaskStatus" USING "status"::text::"TaskStatus";
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "task_status_history" ALTER COLUMN "fromStatus" TYPE "TaskStatus" USING "fromStatus"::text::"TaskStatus";
ALTER TABLE "task_status_history" ALTER COLUMN "toStatus" TYPE "TaskStatus" USING "toStatus"::text::"TaskStatus";

DROP TYPE "TaskStatus_old";

-- Drop the Viewer/Approver distinction entirely.
ALTER TABLE "client_project_access" DROP COLUMN "level";
DROP TYPE "ClientAccessLevel";
