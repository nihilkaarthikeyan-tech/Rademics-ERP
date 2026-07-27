-- A client ID is now reserved when a project is marked as client work, before
-- anyone has said who the client is. Such a reservation has a number (CL-008)
-- but no name yet, so `name` becomes nullable. Postgres permits multiple NULLs
-- under a unique index, so several reservations can be outstanding at once.

ALTER TABLE "client_orgs" ALTER COLUMN "name" DROP NOT NULL;
