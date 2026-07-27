-- Client number: the human-facing reference (rendered CL-001) that staff see in
-- place of the client's identity. Only Super Admin sees the name.
-- Sequence-backed so two clients can never share a code — everyone else
-- identifies a client solely by it.

ALTER TABLE "client_orgs" ADD COLUMN "number" INTEGER;

-- Backfill in creation order, so the oldest client is CL-001.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "client_orgs"
)
UPDATE "client_orgs" c SET "number" = ordered.rn FROM ordered WHERE c.id = ordered.id;

CREATE SEQUENCE "client_orgs_number_seq" AS INTEGER OWNED BY "client_orgs"."number";
SELECT setval(
  'client_orgs_number_seq',
  COALESCE((SELECT MAX("number") FROM "client_orgs"), 0) + 1,
  false
);

ALTER TABLE "client_orgs" ALTER COLUMN "number" SET DEFAULT nextval('client_orgs_number_seq');
ALTER TABLE "client_orgs" ALTER COLUMN "number" SET NOT NULL;

CREATE UNIQUE INDEX "client_orgs_number_key" ON "client_orgs"("number");
