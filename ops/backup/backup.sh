#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Rademics ERP — nightly backup (DEPLOY_RUNBOOK.md §6, Spec §10).
#
# Runs on the VPS as root via /etc/cron.d/rademics-backup (see
# install-backup-cron.sh). Produces, under /var/backups/rademics-erp:
#
#   pg/daily/erp-<stamp>.dump     full pg_dump every night   — kept 30 days
#   pg/weekly/…                   a Sunday snapshot           — kept ~3 months
#   pg/monthly/…                  a 1st-of-month snapshot     — kept 12 months
#   pg/yearly/…                   a Jan-1 snapshot            — kept FOREVER
#   minio/<bucket>/…              mirror of the live file storage
#
# WHAT ROTATION DELETES: only OLD SNAPSHOT COPIES past their tier's age. It never
# touches the live database or the current data — every dump is a COMPLETE snapshot,
# so the newest one always holds all history. The weekly/monthly/yearly copies are
# HARDLINKS to the daily file, so keeping a long-term archive costs no extra disk
# until the daily is rotated away (then the archive link keeps the data alive).
#
# Off-site copy: set RCLONE_REMOTE below (e.g. "b2:rademics-backups") after
# `rclone config` on the VPS. Empty = skipped with a warning — a backup that only
# lives on this disk does not survive disk failure.
#
# Schedule: 02:30 (install-backup-cron.sh), clear of the API's own 00:20–01:10 jobs.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

COMPOSE_DIR=/opt/rademics-erp
COMPOSE="docker compose -f $COMPOSE_DIR/docker-compose.prod.yml"
BACKUP_ROOT=/var/backups/rademics-erp
MIN_DUMP_BYTES=51200          # a dump under 50 KB means something went wrong

# Per-tier retention (days). Yearly is never pruned (compliance archive).
DAILY_KEEP_DAYS=30
WEEKLY_KEEP_DAYS=84           # ~12 weeks
MONTHLY_KEEP_DAYS=365         # 12 months

RCLONE_REMOTE=""              # e.g. "b2:rademics-backups" — empty disables off-site
STAMP=$(date +%Y%m%d-%H%M%S)

log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERROR: $*"; exit 1; }

cd "$COMPOSE_DIR" || fail "compose dir $COMPOSE_DIR missing"

# Pull single values out of .env.production without sourcing the whole file.
env_get() {
  grep -E "^$1=" .env.production | head -1 | cut -d= -f2- | tr -d '"' \
    || fail "$1 not found in .env.production"
}
PGUSER=$(env_get POSTGRES_USER)
PGDB=$(env_get POSTGRES_DB)
MINIO_USER=$(env_get MINIO_ROOT_USER)
MINIO_PASS=$(env_get MINIO_ROOT_PASSWORD)
S3_BUCKET=$(env_get S3_BUCKET)

mkdir -p "$BACKUP_ROOT/pg/daily" "$BACKUP_ROOT/pg/weekly" \
         "$BACKUP_ROOT/pg/monthly" "$BACKUP_ROOT/pg/yearly" "$BACKUP_ROOT/minio"

# ── 1. Postgres dump (full snapshot) ─────────────────────────────────────────
DUMP="$BACKUP_ROOT/pg/daily/erp-$STAMP.dump"
log "pg_dump → $DUMP"
$COMPOSE exec -T postgres pg_dump -Fc -U "$PGUSER" "$PGDB" > "$DUMP" \
  || { rm -f "$DUMP"; fail "pg_dump failed"; }

SIZE=$(wc -c < "$DUMP")
[ "$SIZE" -ge "$MIN_DUMP_BYTES" ] \
  || { rm -f "$DUMP"; fail "dump suspiciously small ($SIZE bytes) — not keeping it"; }
log "pg_dump ok ($SIZE bytes)"

# ── 2. Promote to archive tiers (hardlinks — no extra disk until daily rotates) ─
# Sunday → weekly, 1st of month → monthly, Jan 1 → yearly.
[ "$(date +%u)" = "7"   ] && ln -f "$DUMP" "$BACKUP_ROOT/pg/weekly/erp-$STAMP.dump"  && log "→ weekly archive"
[ "$(date +%d)" = "01"  ] && ln -f "$DUMP" "$BACKUP_ROOT/pg/monthly/erp-$STAMP.dump" && log "→ monthly archive"
[ "$(date +%j)" = "001" ] && ln -f "$DUMP" "$BACKUP_ROOT/pg/yearly/erp-$STAMP.dump"  && log "→ yearly archive"

# ── 3. MinIO mirror (app bucket + quarantine) ────────────────────────────────
# Incremental: only changed objects transfer. This is a live MIRROR — a file
# deleted in the app is dropped here on the next run (it is disaster-recovery, not
# a delete-proof archive; for that, enable MinIO bucket versioning). See README.
log "minio mirror → $BACKUP_ROOT/minio"
docker run --rm --network rademics-erp_rademics \
  -v "$BACKUP_ROOT/minio:/mirror" \
  --entrypoint /bin/sh minio/mc:latest -c "
    mc alias set local http://minio:9000 '$MINIO_USER' '$MINIO_PASS' >/dev/null &&
    mc mirror --overwrite --remove local/$S3_BUCKET /mirror/$S3_BUCKET &&
    mc mirror --overwrite --remove local/$S3_BUCKET-quarantine /mirror/$S3_BUCKET-quarantine
  " || fail "minio mirror failed"
log "minio mirror ok ($(find "$BACKUP_ROOT/minio" -type f | wc -l) objects)"

# ── 4. Rotation (prunes OLD SNAPSHOT COPIES only; yearly kept forever) ────────
prune() { # dir, keep_days
  n=$(find "$1" -name '*.dump' -mtime +"$2" -print -delete | wc -l)
  log "rotation: removed $n snapshot(s) from $(basename "$1")/ older than $2 days"
}
prune "$BACKUP_ROOT/pg/daily"   "$DAILY_KEEP_DAYS"
prune "$BACKUP_ROOT/pg/weekly"  "$WEEKLY_KEEP_DAYS"
prune "$BACKUP_ROOT/pg/monthly" "$MONTHLY_KEEP_DAYS"
log "rotation: yearly/ kept indefinitely ($(find "$BACKUP_ROOT/pg/yearly" -name '*.dump' | wc -l) archive(s))"

# ── 5. Off-site copy ─────────────────────────────────────────────────────────
if [ -n "$RCLONE_REMOTE" ] && command -v rclone >/dev/null 2>&1; then
  log "off-site → $RCLONE_REMOTE"
  rclone sync "$BACKUP_ROOT/pg"    "$RCLONE_REMOTE/pg"    || fail "rclone pg sync failed"
  rclone sync "$BACKUP_ROOT/minio" "$RCLONE_REMOTE/minio" || fail "rclone minio sync failed"
  log "off-site ok"
else
  log "WARNING: no off-site copy (RCLONE_REMOTE unset or rclone not installed)"
fi

log "backup complete: $DUMP"
