#!/bin/sh
# Pull-based deploy. The server asks the registry for a new image; GitHub never connects to the server,
# so this also works behind a university firewall (outbound HTTPS only).
#   Cron (every 5 min):  */5 * * * * cd /opt/bonlab && sh scripts/deploy.sh >> snapshots/deploy.log 2>&1
#   Which image:         BONLAB_TAG in .env (staging: main, production: a release such as v1.0.0)
# On a failed health check it switches back to the previous image and skips the bad one until a newer one appears.
set -eu
cd "$(dirname "$0")/.."
mkdir -p snapshots
exec 9>snapshots/.deploy.lock
flock -n 9 || exit 0

tag=$(sed -n 's/^BONLAB_TAG=//p' .env | tr -d '"\r')
image="ghcr.io/bfirstkok/bonlabweb:${tag:-main}"
log() { echo "$(date -Is) $*"; }

docker pull -q "$image" >/dev/null
new=$(docker image inspect -f '{{.Id}}' "$image")
cid=$(docker compose ps -q web || true)
old=$( [ -n "$cid" ] && docker inspect -f '{{.Image}}' "$cid" || echo none)
[ "$new" = "$old" ] && exit 0
[ "$new" = "$(cat snapshots/.deploy-bad 2>/dev/null || true)" ] && exit 0

log "deploying $image ($new), previous $old"
sh scripts/backup.sh
[ "$old" != none ] && docker tag "$old" bonlab-web:previous
docker compose up -d --no-build

for i in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q web)")
  [ "$status" = healthy ] && { log "healthy"; rm -f snapshots/.deploy-bad; docker image prune -f >/dev/null; exit 0; }
  sleep 3
done

log "health check failed ($status), rolling back"
echo "$new" > snapshots/.deploy-bad
if [ "$old" != none ]; then
  docker tag bonlab-web:previous "$image"
  docker compose up -d --no-build
fi
exit 1
