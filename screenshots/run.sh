#!/usr/bin/env bash
# Capture README screenshots with a temporary database.
# Run from the repo root: ./screenshots/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BACKEND_PID=0
FRONTEND_PID=0

# Kill a server and anything it spawned. `kill $PID` alone is not enough: a
# launcher (npx, python -m) leaves the real server as a child, and an orphaned
# child inherits this script's stdout. When run non-interactively —
# `./screenshots/run.sh | tail`, or from CI — the reader then waits forever on
# a pipe that the orphan is still holding open, long after every screenshot has
# been written. Signal the whole process group so nothing survives to hold it.
kill_tree() {
  local pid=$1
  [[ $pid -gt 0 ]] || return 0
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
}

cleanup() {
  kill_tree "$BACKEND_PID"
  kill_tree "$FRONTEND_PID"
  rm -f "${TMPDB:-}" /tmp/screenshot_token.txt
}
trap cleanup EXIT

VENV=/tmp/screenshots-venv
echo "==> Installing backend dependencies into $VENV..."
python3 -m venv "$VENV" --system-site-packages
"$VENV/bin/pip" install -q -r backend/requirements.txt
PY="$VENV/bin/python3"

TMPDB=$(mktemp /tmp/screenshots-XXXXX.db)

echo "==> Seeding temporary database..."
DATABASE_URL="sqlite:///$TMPDB" JWT_SECRET="screenshots-secret" E2E_TEST=1 \
  "$PY" screenshots/seed.py > /tmp/screenshot_token.txt
TOKEN=$(cat /tmp/screenshot_token.txt)

echo "==> Starting backend on :8000..."
DATABASE_URL="sqlite:///$TMPDB" \
  OIDC_PROVIDERS='[{"name":"google","label":"Google","client_id":"demo.apps.googleusercontent.com","client_secret":"demo-secret","discovery_url":"https://accounts.google.com/.well-known/openid-configuration"}]' \
  ADMIN_EMAIL="demo@example.com;admin@e2e.test" \
  E2E_TEST=1 JWT_SECRET="screenshots-secret" \
  setsid "$PY" -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir backend \
  > /tmp/screenshots-backend.log 2>&1 &
BACKEND_PID=$!

echo "==> Starting frontend on :5173..."
cd frontend
# The local binary rather than `npx vite`: npx adds a wrapper process, and $! is
# then the wrapper, not the server that actually has to be killed.
setsid ./node_modules/.bin/vite --port 5173 --host 127.0.0.1 --strictPort \
  > /tmp/screenshots-frontend.log 2>&1 &
FRONTEND_PID=$!
cd ..

# Wait for backend and frontend to be ready.
echo "==> Waiting for services..."
wait_for() {
  local url=$1 name=$2 log=$3
  for _ in $(seq 1 60); do
    curl -sf "$url" > /dev/null 2>&1 && return 0
    sleep 1
  done
  echo "$name did not come up within 60s — last 40 lines of $log:" >&2
  tail -40 "$log" >&2 || true
  return 1
}
wait_for http://127.0.0.1:8000/api/health backend  /tmp/screenshots-backend.log
wait_for http://127.0.0.1:5173            frontend /tmp/screenshots-frontend.log
echo "    Both services ready."

echo "==> Capturing screenshots..."
cd frontend
SCREENSHOT_EMAIL="demo@example.com" SCREENSHOT_BASE_URL="http://localhost:5173" \
  npx playwright test --project=main e2e/screenshots.spec.ts ${GREP:+-g "$GREP"} 2>&1
cd ..

echo "==> Done. Screenshots:"
ls -la screenshots/*.png 2>/dev/null
