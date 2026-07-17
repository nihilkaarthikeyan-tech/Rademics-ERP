# Backups — Rademics ERP (runbook §6)

Three scripts, all run **on the VPS as root**:

| Script | Purpose |
|---|---|
| `backup.sh` | Nightly: full `pg_dump -Fc` snapshot + tiered retention + incremental MinIO mirror + optional off-site rclone copy → `/var/backups/rademics-erp` |
| `restore-drill.sh` | Restores the newest snapshot into a scratch container and compares table/row counts against the live DB. Run before go-live, then quarterly. |
| `install-backup-cron.sh` | Installs both to `/usr/local/bin`, creates the 02:30 daily cron, runs a first backup immediately. |

## What is stored, and what "deletion" means

**Nothing about the live database or live files is ever deleted by these scripts.**
The only thing rotation removes is **old snapshot copies** past their tier's age.

Every nightly `pg_dump` is a **complete snapshot of the entire database** — all users,
attendance, tasks, invoices, payroll, everything, since day one. So the newest snapshot
alone already holds all history; pruning a month-old daily loses no data.

### Retention tiers (grandfather-father-son)

| Tier | Taken | Kept | Purpose |
|---|---|---|---|
| `pg/daily/` | every night | 30 days | disaster recovery — rewind to any recent night |
| `pg/weekly/` | Sundays | ~3 months | medium-term |
| `pg/monthly/` | 1st of month | 12 months | year of month-end points |
| `pg/yearly/` | Jan 1 | **forever** | compliance archive (financial records, 6–8 yr) |

The weekly/monthly/yearly copies are **hardlinks** to the daily file — a long-term
archive costs no extra disk until the daily is rotated away, at which point the archive
link keeps the data alive. Tune the `*_KEEP_DAYS` values at the top of `backup.sh`.

### About the file (MinIO) mirror

`minio/` is a **live mirror** for disaster recovery: a file deleted in the app is dropped
from the mirror on the next run. It is not a delete-proof archive. If you need to recover
files someone deleted, enable **MinIO bucket versioning** on the VPS (ask and I'll wire
it) — then every version is retained independently of this mirror.

## Install

```sh
scp -r ops/backup root@<vps>:/opt/rademics-erp/ops/
ssh root@<vps> "cd /opt/rademics-erp/ops/backup && sh install-backup-cron.sh"
ssh root@<vps> rademics-restore-drill
```

## Off-site copy (strongly recommended)

A backup on the same disk as the database does not survive disk failure.
Once a destination exists (any S3/B2 bucket, or a second box):

1. `apt install rclone && rclone config` on the VPS (one-time).
2. Set `RCLONE_REMOTE="<remote>:<bucket>"` at the top of `/usr/local/bin/rademics-backup`.

Until then every run logs `WARNING: no off-site copy`.

## Verify it's working

- `tail /var/log/rademics-backup.log` — last line of a good run is `backup complete: …`.
- `ls -lh /var/backups/rademics-erp/pg/daily` — one snapshot per night, ≤30 files.
- The drill prints `drill PASSED`; record each run in the ops log.
