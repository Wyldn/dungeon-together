#!/usr/bin/env bash
# Deploy dungeon-together to the Oracle Cloud VM (pm2).
#
# Prerequisites (on Rishi's machine):
#   - Git Bash / WSL / macOS / Linux
#   - SSH private key for opc@132.226.66.6
#   - Changes already pushed to origin/main on GitHub
#
# Usage:
#   ./tools/deploy.sh
#   KEY=~/path/to/ssh-key-2026-07-04.key ./tools/deploy.sh
#   ./tools/deploy.sh --no-restart   # pull only (static/js/css changes; optional)

set -euo pipefail

HOST="${DEPLOY_HOST:-opc@132.226.66.6}"
REMOTE_DIR="${DEPLOY_DIR:-~/dungeon-together}"
PM2_NAME="${DEPLOY_PM2:-dungeon-together}"
KEY="${KEY:-/c/Users/rishi/Downloads/ssh-key-2026-07-04.key}"
RESTART=1

for arg in "$@"; do
  case "$arg" in
    --no-restart) RESTART=0 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$KEY" ]]; then
  echo "SSH key not found: $KEY" >&2
  echo "Set KEY=/path/to/your.key and re-run." >&2
  exit 1
fi

# Git Bash / Windows often leave .key files world-readable; ssh may refuse them.
chmod 600 "$KEY" 2>/dev/null || true

echo "Deploying to $HOST ($REMOTE_DIR)…"
echo "Key: $KEY"
echo

ssh -i "$KEY" \
  -o StrictHostKeyChecking=accept-new \
  -o ConnectTimeout=15 \
  "$HOST" \
  RESTART="$RESTART" REMOTE_DIR="$REMOTE_DIR" PM2_NAME="$PM2_NAME" \
  'bash -s' <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

echo "=== HEAD before ==="
git log --oneline -1

echo "=== git pull ==="
git pull --ff-only origin main

echo "=== HEAD after ==="
git log --oneline -1

if [[ "${RESTART}" == "1" ]]; then
  echo "=== pm2 restart ==="
  # npm install only if package-lock changed (cheap no-op otherwise)
  if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -qE '^server/(package\.json|package-lock\.json)$'; then
    echo "server deps changed — npm install"
    (cd server && npm install --omit=dev)
  fi
  pm2 restart "$PM2_NAME" --update-env
  pm2 save
else
  echo "=== skip pm2 restart (--no-restart) ==="
  echo "Static files are served from disk; hard-refresh the browser if needed."
fi

echo "=== pm2 status ==="
pm2 status "$PM2_NAME" | grep -E "$PM2_NAME|name|─" || pm2 status "$PM2_NAME"

echo
echo "Live: http://132.226.66.6:3117/"
REMOTE

echo
echo "Done."
