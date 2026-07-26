-- Remove PM as a role (2026-07-25).
--
-- Running a project is now an APPOINTMENT (Project.pmId), granted per project by
-- HR / Super Admin, not a role someone holds company-wide. Postgres cannot drop a
-- value from an enum in place, so both enums are rebuilt and the columns re-typed.
--
-- Safety: this migration REFUSES to run if any user still holds PM. Reassign them
-- first (they most likely become EMPLOYEE, then get appointed to their projects).
-- Verified before writing: production had 0 PM users, 0 projects with a manager
-- set, and 0 leave requests, so nothing is being reassigned silently here.

DO $$
DECLARE
  stragglers int;
BEGIN
  SELECT count(*) INTO stragglers FROM "users" WHERE "role" = 'PM';
  IF stragglers > 0 THEN
    RAISE EXCEPTION
      'Cannot drop the PM role: % user(s) still hold it. Reassign them (e.g. to EMPLOYEE) and appoint them to their projects first.', stragglers;
  END IF;
END $$;

-- The seed grants for PM are meaningless once the role is gone.
DELETE FROM "role_capabilities" WHERE "role" = 'PM';

-- ── Role: SUPER_ADMIN | HR | TEAM_LEAD | EMPLOYEE | CLIENT | FINANCE ──
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'CLIENT', 'FINANCE');

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "role_capabilities"
  ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");

DROP TYPE "Role_old";

-- ── LeaveApprovalLevel: the TL → PM → HR chain loses its middle rung ──
-- Leave follows the reporting line, and a project appointment cannot stand in for
-- that (someone may run several projects, or none). Any request sitting at PM is
-- moved up to HR, which is where it would have escalated to anyway.
UPDATE "leave_requests" SET "currentLevel" = 'HR' WHERE "currentLevel" = 'PM';

ALTER TYPE "LeaveApprovalLevel" RENAME TO "LeaveApprovalLevel_old";
CREATE TYPE "LeaveApprovalLevel" AS ENUM ('TEAM_LEAD', 'HR');

ALTER TABLE "leave_requests"
  ALTER COLUMN "currentLevel" TYPE "LeaveApprovalLevel" USING ("currentLevel"::text::"LeaveApprovalLevel");

DROP TYPE "LeaveApprovalLevel_old";
