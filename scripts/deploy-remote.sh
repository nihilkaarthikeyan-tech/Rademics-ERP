#!/bin/sh
# Server side of a deploy. Run BY scripts/deploy.ps1, not by hand.
#
# Prints machine-readable KEY=VALUE lines the caller parses; the caller, not
# this script, decides whether the deploy passed. Everything here is reported
# rather than judged, so a half-truth can't hide behind an exit code.
#
# Usage: deploy-remote.sh <phase> [release-sha]
#   before   — snapshot what is live right now
#   deploy   — extract the synced release, rebuild, recreate
#   after    — snapshot again, so the caller can prove something changed
set -e

REPO=/opt/rademics-erp
COMPOSE="docker compose --env-file $REPO/.env.production -f $REPO/docker-compose.prod.yml"
PHASE="$1"
SHA="$2"

image_id() { docker images --no-trunc --format '{{.ID}}' rademics-erp:latest 2>/dev/null | head -1; }
container_image() { docker inspect "$1" --format '{{.Image}}' 2>/dev/null || echo "MISSING"; }

snapshot() {
  echo "IMAGE_ID=$(image_id)"
  for c in api internal portal; do
    echo "CONTAINER_${c}=$(container_image rademics-erp-${c}-1)"
  done
}

case "$PHASE" in
  before)
    snapshot
    ;;

  deploy)
    [ -n "$SHA" ] || { echo "ERROR=missing release sha"; exit 1; }
    cd "$REPO"

    # A database dump before every deploy. Cheap, and the one thing you cannot
    # recreate afterwards if a migration surprises you.
    docker exec rademics-erp-postgres-1 pg_dump -U rademics rademics \
      | gzip > "/root/pre-deploy-${SHA}-$(date +%Y%m%d-%H%M).sql.gz"
    echo "BACKUP=ok"

    # Build via `api` DELIBERATELY. The single shared image is defined under that
    # service; naming `internal` or `portal` used to build nothing at all and
    # exit 0, so the follow-up recreate silently restarted the OLD image.
    export SENTRY_RELEASE="$SHA"
    $COMPOSE build api
    echo "BUILD=ok"

    # --force-recreate: without it compose can decide the containers are already
    # "correct" and leave them on the previous image.
    $COMPOSE up -d --force-recreate api internal portal
    echo "RECREATE=ok"
    ;;

  after)
    snapshot
    # Migrations run in the api container's start command; surface the outcome.
    if docker logs rademics-erp-api-1 2>&1 | tail -80 | grep -q 'migrations have been applied\|No pending migrations'; then
      echo "MIGRATIONS=ok"
    else
      echo "MIGRATIONS=unknown"
    fi
    ;;

  *)
    echo "ERROR=unknown phase '$PHASE'"
    exit 1
    ;;
esac
