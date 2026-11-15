#!/bin/sh
# Snapshot ./data (pages, uploads, news.json, per-save backups) into ./snapshots, keep the last 14 days.
# Cron (daily 03:00):  0 3 * * * cd /opt/bonlab && sh scripts/backup.sh >> snapshots/backup.log 2>&1
# Offsite (optional):  set BACKUP_BUCKET=gs://your-bucket to also copy each snapshot to Cloud Storage.
# Restore:             docker compose down && rm -rf data && tar xzf snapshots/<file>.tgz && docker compose up -d
set -eu
cd "$(dirname "$0")/.."
mkdir -p snapshots
file="snapshots/bonlab-data-$(date +%F-%H%M).tgz"
tar czf "$file" data
echo "$(date -Is) wrote $file"
if [ -n "${BACKUP_BUCKET:-}" ]; then gsutil -q cp "$file" "$BACKUP_BUCKET/"; fi
find snapshots -name 'bonlab-data-*.tgz' -mtime +14 -delete
