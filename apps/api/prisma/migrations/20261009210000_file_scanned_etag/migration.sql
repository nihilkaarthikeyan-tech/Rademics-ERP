-- Files (2026-10-09): remember the exact object that passed the virus scan.
ALTER TABLE "file_versions" ADD COLUMN "scannedEtag" TEXT;
