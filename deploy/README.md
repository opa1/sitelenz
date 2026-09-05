# Deploying SiteLenz

Production deploy target: OCI ARM64 Ubuntu 24.04 VM (`129.213.16.57`), behind Caddy at `api.sitelenz.online`. The app itself never binds a public port — it listens on `127.0.0.1:3002` only, and Caddy reverse-proxies to it.

## First-time server setup

Run once, on the server, before the first CI deploy.

1. Create the deploy directory:

   ```bash
   sudo mkdir -p /opt/apps/sitelenz/scripts
   ```

2. Copy `.env.example` to `/opt/apps/sitelenz/.env` and fill in every `REPLACE_*` value (Postgres password, Redis password, Cloudinary credentials, Groq API key, a random `WEBHOOK_SECRET`, and the Algorand payout address for whichever `NETWORK` is active). This file is server state — it is never synced by CI and must never be committed.

   ```bash
   cp .env.example /opt/apps/sitelenz/.env
   $EDITOR /opt/apps/sitelenz/.env
   ```

3. Create `/opt/apps/sitelenz/image.env` — this is only a fallback for manual/rollback runs of `deploy.sh` (normal CI deploys pass these as environment variables directly and never touch this file):

   ```bash
   cat <<'EOF' | sudo tee /opt/apps/sitelenz/image.env
   IMAGE_OWNER=opa1
   REPO_NAME=sitelenz
   IMAGE_TAG=<sha>
   EOF
   ```

   Replace `<sha>` with the short commit SHA of the image you want running (CI computes and uses `${GITHUB_SHA::7}` as the tag — see `.github/workflows/deploy-production.yml`).

4. Create the systemd unit at `/etc/systemd/system/sitelenz.service`. This mirrors the `powrth.service` pattern used elsewhere on this server (Compose-managed container, depending on the shared `infra.service` for the `postgres`/`redis`/`alpha` network to already be up) — adjust to match that file exactly if it differs from this:

   ```ini
   [Unit]
   Description=SiteLenz API
   After=docker.service infra.service network-online.target
   Requires=docker.service infra.service
   Wants=network-online.target

   [Service]
   Type=oneshot
   RemainAfterExit=yes
   WorkingDirectory=/opt/apps/sitelenz
   ExecStart=/usr/bin/docker compose -f compose.yml up -d
   ExecStop=/usr/bin/docker compose -f compose.yml down
   TimeoutStartSec=0

   [Install]
   WantedBy=multi-user.target
   ```

5. Enable it:

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable sitelenz.service
   ```

   The very first `docker compose up` needs an image to actually pull — either run `scripts/deploy.sh` once by hand (see below) before enabling/starting the unit, or let the first CI deploy do it.

## Ongoing deploys

Handled entirely by `.github/workflows/deploy-production.yml` on every push to `main` (or a manual `workflow_dispatch` run):

1. **verify** — `npm ci`, build, typecheck, test
2. **build-and-push** — multi-platform (`linux/amd64` + `linux/arm64`) image build, pushed to `ghcr.io/opa1/sitelenz-api:<short-sha>`, then confirms both platforms actually landed in the pushed manifest
3. **deploy** — syncs `deploy/compose.yml` and `deploy/scripts/` to `/opt/apps/sitelenz/` (never `.env`), then runs `scripts/deploy.sh` over SSH, which logs in to GHCR, pulls the new image, recreates the `sitelenz-api` container, and polls `http://localhost:3002/health` until it responds (or fails the deploy)

### GitHub secrets required

| Secret | Used for |
|---|---|
| `SERVER_HOST` | SSH target (`129.213.16.57`) |
| `SERVER_USER` | SSH user on the OCI VM |
| `SERVER_KEY` | SSH private key for that user |
| `GHCR_USER` | GHCR username the *server* uses to `docker pull` (separate from the ephemeral `GITHUB_TOKEN` the Actions runner uses to push — the runner's token doesn't exist anymore by the time the server needs to pull) |
| `GHCR_TOKEN` | A GHCR personal access token (`read:packages` is enough) for the same |

`GITHUB_TOKEN` (built-in, no setup needed) is what the `build-and-push` job itself uses to push — it's never sent to the server.

### Manual run / rollback

To roll back, redeploy with a previous `IMAGE_TAG` rather than reverting code:

```bash
ssh <user>@129.213.16.57
sudo vi /opt/apps/sitelenz/image.env   # set IMAGE_TAG back to the last-known-good short SHA
cd /opt/apps/sitelenz
GHCR_USER=<your-ghcr-username> GHCR_TOKEN=<your-ghcr-pat> bash scripts/deploy.sh
```

(`IMAGE_OWNER`/`REPO_NAME`/`IMAGE_TAG` come from `image.env` automatically when they aren't already set in the environment; `GHCR_USER`/`GHCR_TOKEN` are never read from a file and must always be passed explicitly.)

## Caddy

Add to the shared Caddyfile on the server:

```
api.sitelenz.online {
	reverse_proxy 127.0.0.1:3002
}
```

Then reload Caddy (`sudo systemctl reload caddy` or however the shared Caddy instance on this box is managed).
