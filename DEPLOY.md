# Deploying BONLAB

## How it fits together

```
developer ── PR ──> GitHub Actions: build + smoke test + docker build      (no deploy)
          ── merge to main ──> CI pushes ghcr.io/bfirstkok/bonlabweb:main
          ── git tag v1.0.0 ──> CI pushes ghcr.io/bfirstkok/bonlabweb:v1.0.0

server (cron, every 5 min): scripts/deploy.sh
    pull image named by BONLAB_TAG ─> changed? ─> backup data/ ─> restart ─> healthy? ─> done
                                                                          └─ no ─> previous image back
```

GitHub never connects to the server. The server only pulls, so the same setup works behind a university firewall that allows outbound HTTPS.

| Server | `BONLAB_TAG` | Updates |
|---|---|---|
| Staging (GCP test VM) | `main` | automatically after every merge |
| Production (university) | a release, e.g. `v1.0.0` | when you change the tag in `.env` |

Everything the site needs to survive a move is in two places: `.env` and `data/`. The code and image can always be rebuilt.

## One-time GitHub setup

1. Merge the PR that adds `.github/workflows/ci.yml`. The first push to `main` creates the package `bonlabweb`.
2. GitHub → your profile → Packages → `bonlabweb` → Package settings → **Change visibility → Public**. Then servers pull without logging in. (If it must stay private: on each server run `docker login ghcr.io` with a token that has only `read:packages`.)
3. Repo → Settings → Branches → protect `main`: require the `test` and `image` checks to pass before merging.

## New server (GCP VM or university)

Needs Ubuntu (or any Linux with Docker), ports 80 and 443 open, and a DNS name or a static IP.

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 2 GB swap: only needed for a 4 GB machine that builds images itself
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

sudo mkdir -p /opt/bonlab && sudo chown $USER /opt/bonlab
git clone https://github.com/bfirstkok/bonlabweb /opt/bonlab
cd /opt/bonlab
cp .env.example .env
nano .env        # admin password, BONLAB_SESSION_SECRET (openssl rand -hex 32), SITE_ADDRESS, BONLAB_TAG
mkdir -p data snapshots && sudo chown 1000:1000 data   # cron writes its logs into snapshots/

docker compose up -d
docker compose ps   # web must show "healthy"

sudo apt-get install -y cron   # minimal Ubuntu images ship without cron
crontab -e
#   */5 * * * * cd /opt/bonlab && sh scripts/deploy.sh >> snapshots/deploy.log 2>&1
#   0 3 * * *   cd /opt/bonlab && sh scripts/backup.sh >> snapshots/backup.log 2>&1
```

`SITE_ADDRESS`: the real domain (e.g. `bonlab.example.ac.th`), or `<ip-with-dashes>.sslip.io` until DNS exists. Caddy gets the HTTPS certificate by itself.

The server copy of the repo only supplies `docker-compose.yml`, `Caddyfile` and the scripts. Run `git pull` when one of those files changes.

## Releasing to production

```bash
git checkout main && git pull
git tag v1.0.0 && git push origin v1.0.0     # CI builds ghcr.io/bfirstkok/bonlabweb:v1.0.0
```

On the production server, set `BONLAB_TAG=v1.0.0` in `.env`. The next cron run deploys it, or run `sh scripts/deploy.sh` now.

## Rollback

- Automatic: if the new container is not healthy within 90 seconds, `deploy.sh` restarts the previous image and skips the bad one until a newer image is pushed. Read `snapshots/deploy.log`.
- Manual: set `BONLAB_TAG` to an older release (or `sha-xxxxxxx` from the GitHub Packages page) and run `sh scripts/deploy.sh`.
- Data: every deploy and every night writes `snapshots/bonlab-data-*.tgz`. To restore one:
  ```bash
  docker compose down && rm -rf data && tar xzf snapshots/<file>.tgz && sudo chown -R 1000:1000 data && docker compose up -d
  ```

## Moving to another server

1. On the old server, run `sh scripts/backup.sh`.
2. Copy `.env` and the newest `snapshots/*.tgz` to the new server. Use `scp`, never git: `.env` holds secrets.
3. On the new server, follow **New server**, but restore the snapshot instead of starting with an empty `data/`.
4. Point DNS to the new server, then stop the old one.

## Checks before handing over

- [ ] `/admin` login works, edit and save a page, upload an image
- [ ] `docker compose restart` keeps the edits
- [ ] restore one snapshot on purpose and confirm the site comes back
- [ ] `/admin/news.html` adds a post and it shows on `/news.html`
- [ ] push a commit to `main` and see the staging server update by itself (`snapshots/deploy.log`)
