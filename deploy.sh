#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env file at $ENV_FILE" >&2
  exit 1
fi

# Load only simple KEY=VALUE lines from .env
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^\s*# ]] && continue
  key="$(echo "$key" | tr -d ' ')"
  value="${value# }"
  value="${value% }"
  export "$key"="$value"
done < "$ENV_FILE"

if [[ -z "${DEPLOY_TARGET:-}" ]]; then
  echo "DEPLOY_TARGET is not set in .env" >&2
  echo "Example: DEPLOY_TARGET=user@host:/path/to/site" >&2
  exit 1
fi

SRC_DIR="$ROOT_DIR/public/"

RSYNC_FLAGS=("-az" "--itemize-changes")

if [[ "${DEPLOY_DELETE:-}" == "true" ]]; then
  RSYNC_FLAGS+=("--delete")
fi

if [[ "${DEPLOY_DRY_RUN:-}" == "true" ]]; then
  RSYNC_FLAGS+=("--dry-run")
fi

echo "Deploying $SRC_DIR to $DEPLOY_TARGET"
rsync "${RSYNC_FLAGS[@]}" "$SRC_DIR" "$DEPLOY_TARGET"
