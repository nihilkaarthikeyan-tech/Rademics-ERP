#!/bin/sh
# One-time installer for the nightly backup (run on the VPS as root, from this
# directory). Idempotent — safe to re-run after editing backup.sh.
set -eu

[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }

mkdir -p /var/backups/rademics-erp/pg /var/backups/rademics-erp/minio
chmod 700 /var/backups/rademics-erp

install -m 0755 backup.sh /usr/local/bin/rademics-backup
install -m 0755 restore-drill.sh /usr/local/bin/rademics-restore-drill

# 02:30 daily — clear of the API's own 00:20–01:10 job window.
cat > /etc/cron.d/rademics-backup <<'EOF'
30 2 * * * root /usr/local/bin/rademics-backup >> /var/log/rademics-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/rademics-backup

echo "Installed. Cron: 02:30 daily → /var/log/rademics-backup.log"
echo "Running a first backup now to prove it works…"
/usr/local/bin/rademics-backup
echo
echo "Next: run 'rademics-restore-drill' to complete the §6 drill."
