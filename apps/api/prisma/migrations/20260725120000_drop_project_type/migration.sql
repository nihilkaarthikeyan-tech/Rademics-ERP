-- Drop the project "type" flag (2026-07-25).
--
-- PROJECT vs STREAM decided exactly one thing: whether an end date was allowed.
-- That is already expressed by the end date itself — set = finite, absent =
-- ongoing — so the flag was a question asked at creation time that bought
-- nothing. `cadence` went with it: it only ever described a work stream's rhythm
-- and was never read anywhere.
--
-- No data is lost that carried meaning: every STREAM already had endDate NULL,
-- which after this migration is precisely what "ongoing" looks like.

ALTER TABLE "projects" DROP COLUMN IF EXISTS "type";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "cadence";

DROP TYPE IF EXISTS "ProjectType";
