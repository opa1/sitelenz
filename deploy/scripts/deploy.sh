#!/usr/bin/env bash
set -euo pipefail

# Deploys sitelenz-api on the OCI VM. Runs from /opt/apps/sitelenz (this
# script lives at /opt/apps/sitelenz/scripts/deploy.sh) via either:
#   - CI over SSH, which exports IMAGE_OWNER/REPO_NAME/IMAGE_TAG/GHCR_USER/
#     GHCR_TOKEN as environment variables before invoking this script, or
#   - a manual rollback run on the server itself, with none of those set -
#     in which case IMAGE_OWNER/REPO_NAME/IMAGE_TAG fall back to
#     /opt/apps/sitelenz/image.env (edit IMAGE_TAG there to roll back), and
#     GHCR_USER/GHCR_TOKEN must still be passed by hand. Credentials are
#     never read from a file on disk.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f image.env ] && [ -z "${IMAGE_OWNER:-}" ] && [ -z "${REPO_NAME:-}" ] && [ -z "${IMAGE_TAG:-}" ]; then
  echo "==> No IMAGE_OWNER/REPO_NAME/IMAGE_TAG in the environment - sourcing image.env"
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

API_IMAGE="ghcr.io/${IMAGE_OWNER}/${REPO_NAME}-api:${IMAGE_TAG}"
MIGRATOR_IMAGE="ghcr.io/${IMAGE_OWNER}/${REPO_NAME}-migrator:${IMAGE_TAG}"
ENV_FILE="/opt/apps/sitelenz/.env"

# Every deploy pulls a new immutable-SHA-tagged api image and a new migrator
# image, and nothing ever removed the old ones - disk filled up over
# repeated deploys until a pull failed with "no space left on device".
# `docker image prune -af` only removes images not referenced by any
# container, so the currently-running sitelenz-api's image is untouched;
# it just clears out every previous deploy's now-unused tag. Runs before
# login/pull so a deploy started with the disk already full has a chance
# to recover space and succeed instead of failing again.
echo "==> Pruning unused Docker images to reclaim disk space"
docker image prune -af || true

echo "==> Logging in to ghcr.io as ${GHCR_USER}"
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

echo "==> Pulling ${API_IMAGE}"
if ! docker pull "$API_IMAGE"; then
  echo "!! Failed to pull ${API_IMAGE} - logging out and aborting before touching the running container" >&2
  docker logout ghcr.io
  exit 1
fi

echo "==> Pulling ${MIGRATOR_IMAGE}"
if ! docker pull "$MIGRATOR_IMAGE"; then
  echo "!! Failed to pull ${MIGRATOR_IMAGE} - logging out and aborting before touching the running container" >&2
  docker logout ghcr.io
  exit 1
fi

docker logout ghcr.io

echo "==> Both images pulled - running migrations against the shared postgres before touching sitelenz-api"
if ! docker run --rm --network alpha --env-file "$ENV_FILE" "$MIGRATOR_IMAGE"; then
  echo "!! Migration failed - aborting deploy, sitelenz-api left untouched" >&2
  exit 1
fi

echo "==> Migrations applied - recreating sitelenz-api"
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

# Only reached after a passing health check - image.env is what
# sitelenz.service reads on boot, so it must never be updated to a tag that
# hasn't actually been proven healthy. A failed health check above already
# exited before this point, leaving whatever tag was last known-good in
# place for reboot safety. Written to a temp file in the same directory
# (so the final `mv` is a same-filesystem rename, not a copy) and moved
# into place, so a crash mid-write can't leave a corrupt/partial image.env.
echo "==> Health check passed - updating image.env for reboot safety"
image_env_tmp="$(mktemp image.env.XXXXXX)"
cat > "$image_env_tmp" <<EOF
IMAGE_OWNER=${IMAGE_OWNER}
REPO_NAME=${REPO_NAME}
IMAGE_TAG=${IMAGE_TAG}
EOF
chmod 600 "$image_env_tmp"
mv -f "$image_env_tmp" image.env

echo "==> Deploy complete: ${API_IMAGE}"
