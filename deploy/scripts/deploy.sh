#!/usr/bin/env bash
set -euo pipefail

# Deploys sitelenz-api on the OCI VM. Runs from /opt/apps/sitelenz (this
# script lives at /opt/apps/sitelenz/scripts/deploy.sh) via either:
#   - CI over SSH, which exports IMAGE_OWNER/REPO_NAME/IMAGE_TAG/GHCR_USER/
#     GHCR_TOKEN as environment variables before invoking this script, or
#   - a manual rollback run on the server itself, with none of those set —
#     in which case IMAGE_OWNER/REPO_NAME/IMAGE_TAG fall back to
#     /opt/apps/sitelenz/image.env (edit IMAGE_TAG there to roll back), and
#     GHCR_USER/GHCR_TOKEN must still be passed by hand. Credentials are
#     never read from a file on disk.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f image.env ] && [ -z "${IMAGE_OWNER:-}" ] && [ -z "${REPO_NAME:-}" ] && [ -z "${IMAGE_TAG:-}" ]; then
  echo "==> No IMAGE_OWNER/REPO_NAME/IMAGE_TAG in the environment — sourcing image.env"
  set -a
  # shellcheck disable=SC1091
  source image.env
  set +a
fi

: "${IMAGE_OWNER:?IMAGE_OWNER is required}"
: "${REPO_NAME:?REPO_NAME is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required}"
: "${GHCR_USER:?GHCR_USER is required}"
: "${GHCR_TOKEN:?GHCR_TOKEN is required}"

export IMAGE_OWNER REPO_NAME IMAGE_TAG

IMAGE="ghcr.io/${IMAGE_OWNER}/${REPO_NAME}-api:${IMAGE_TAG}"

echo "==> Logging in to ghcr.io as ${GHCR_USER}"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

echo "==> Pulling ${IMAGE}"
if ! docker pull "$IMAGE"; then
  echo "!! Failed to pull ${IMAGE} — logging out and aborting before touching the running container" >&2
  docker logout ghcr.io
  exit 1
fi

docker logout ghcr.io

echo "==> Pull succeeded — recreating sitelenz-api"
if docker inspect sitelenz-api >/dev/null 2>&1; then
  docker rm -f sitelenz-api
fi

docker compose -f compose.yml up -d

echo "==> Waiting for http://localhost:3002/health"
healthy=false
for attempt in $(seq 1 30); do
  if curl -fsS http://localhost:3002/health >/dev/null 2>&1; then
    echo "==> Healthy after ${attempt} attempt(s)"
    healthy=true
    break
  fi
  sleep 2
done

if [ "$healthy" != true ]; then
  echo "!! sitelenz-api did not become healthy in time" >&2
  docker logs --tail 100 sitelenz-api >&2 || true
  exit 1
fi

echo "==> Deploy complete: ${IMAGE}"
