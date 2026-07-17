#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Rademics ERP — restore drill (DEPLOY_RUNBOOK.md §6, Spec §10).
#
# Proves the latest backup actually restores. Run on the VPS as root, at least
# once before go-live and then quarterly:
#
#   ./restore-drill.sh                 # uses the newest dump
#   ./restore-drill.sh /path/to.dump   # or a specific one
#
# What it does:
#   1. Boots a scratch postgres:16 container (never touches the live DB).
#   2. pg_restore's the dump into it.
#   3. Prints table count + per-table row counts, side by side with the LIVE
#      database — the two should match apart from activity since the dump.
#   4. Reports the MinIO mirror object count, then tears the scratch DB down.
#
# Record the run (date, dump used, result) in the ops log per runbook §6.
# ─────────────────────────────────────────────────────────────────────────────
set -eu

COMPOSE_DIR=/opt/rademics-erp
COMPOSE="docker compose -f $COMPOSE_DIR/docker-compose.prod.yml"
BACKUP_ROOT=/var/backups/rademics-erp
SCRATCH=rademics-restore-drill

log() { echo "[$(date '+%F %T')] $*"; }
fail() { log "ERROR: $*"; docker rm -f "$SCRATCH" >/dev/null 2>&1 || true; exit 1; }

DUMP=${1:-$(ls -t "$BACKUP_ROOT"/pg/daily/*.dump "$BACKUP_ROOT"/pg/*/*.dump 2>/dev/null | head -1)}
[ -n "$DUMP" ] && [ -f "$DUMP" ] || fail "no dump found under $BACKUP_ROOT/pg — run backup.sh first"
log "drilling with: $DUMP ($(wc -c < "$DUMP") bytes)"

cd "$COMPOSE_DIR" || fail "compose dir missing"
PGUSER=$(grep -E '^POSTGRES_USER=' .env.production | head -1 | cut -d= -f2- | tr -d '"')
PGDB=$(grep -E '^POSTGRES_DB=' .env.production | head -1 | cut -d= -f2- | tr -d '"')

# ── 1. Scratch DB ────────────────────────────────────────────────────────────
docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
docker run -d --name "$SCRATCH" \
  -e POSTGRES_USER=drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill \
  postgres:16-alpine >/dev/null
log "scratch container up; waiting for postgres…"
TRIES=0
until docker exec "$SCRATCH" pg_isready -U drill >/dev/null 2>&1; do
  TRIES=$((TRIES + 1)); [ "$TRIES" -le 30 ] || fail "scratch postgres never became ready"
  sleep 1
done

# ── 2. Restore ───────────────────────────────────────────────────────────────
docker cp "$DUMP" "$SCRATCH":/tmp/restore.dump
log "pg_restore running…"
docker exec "$SCRATCH" pg_restore --no-owner --role=drill -U drill -d drill /tmp/restore.dump \
  || fail "pg_restore failed"
docker exec "$SCRATCH" psql -U drill -d drill -qc 'ANALYZE' >/dev/null
log "restore ok"

# ── 3. Verify: restored vs live ──────────────────────────────────────────────
COUNT_SQL="select count(*) from information_schema.tables where table_schema='public'"
TOP_SQL="select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc, relname limit 15"

RESTORED_TABLES=$(docker exec "$SCRATCH" psql -U drill -d drill -Atc "$COUNT_SQL")
LIVE_TABLES=$($COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" -Atc "$COUNT_SQL")
log "tables — restored: $RESTORED_TABLES, live: $LIVE_TABLES"
[ "$RESTORED_TABLES" -gt 0 ] || fail "restored database has no tables"
[ "$RESTORED_TABLES" -eq "$LIVE_TABLES" ] || log "WARNING: table count differs from live (pending migration since dump?)"

echo "── restored (top 15 tables by rows) ──"
docker exec "$SCRATCH" psql -U drill -d drill -c "$TOP_SQL"
echo "── live (same query) ──"
$COMPOSE exec -T postgres psql -U "$PGUSER" -d "$PGDB" -c "$TOP_SQL"

# ── 4. MinIO mirror sanity ───────────────────────────────────────────────────
OBJECTS=$(find "$BACKUP_ROOT/minio" -type f 2>/dev/null | wc -l)
log "minio mirror holds $OBJECTS object(s) under $BACKUP_ROOT/minio"
[ "$OBJECTS" -gt 0 ] || log "WARNING: minio mirror is empty — has backup.sh run?"

# ── 5. Teardown ──────────────────────────────────────────────────────────────
docker rm -f "$SCRATCH" >/dev/null
log "drill PASSED — scratch DB removed. Log this run (date, dump, result) in the ops log."
