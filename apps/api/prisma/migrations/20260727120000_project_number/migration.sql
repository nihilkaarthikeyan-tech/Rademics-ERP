-- Project number: a human-facing reference (rendered RAD-001) used to point a
-- client at the right project. Backed by a real sequence so concurrent creates
-- cannot collide — a duplicate number would mean the wrong client is granted the
-- wrong project.

-- 1. Add nullable first so existing rows can be backfilled deterministically.
ALTER TABLE "projects" ADD COLUMN "number" INTEGER;

-- 2. Backfill in creation order, so the oldest project is RAD-001.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "projects"
)
UPDATE "projects" p SET "number" = ordered.rn FROM ordered WHERE p.id = ordered.id;

-- 3. Own sequence, started past the backfilled values.
CREATE SEQUENCE "projects_number_seq" AS INTEGER OWNED BY "projects"."number";
SELECT setval(
  'projects_number_seq',
  COALESCE((SELECT MAX("number") FROM "projects"), 0) + 1,
  false
);

ALTER TABLE "projects" ALTER COLUMN "number" SET DEFAULT nextval('projects_number_seq');
ALTER TABLE "projects" ALTER COLUMN "number" SET NOT NULL;

CREATE UNIQUE INDEX "projects_number_key" ON "projects"("number");
