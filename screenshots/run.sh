#!/usr/bin/env bash
# Capture README screenshots with a temporary database.
# Run from the repo root: ./screenshots/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BACKEND_PID=0
FRONTEND_PID=0
cleanup() {
  [[ $BACKEND_PID  -gt 0 ]] && kill "$BACKEND_PID"  2>/dev/null || true
  [[ $FRONTEND_PID -gt 0 ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  rm -f "$TMPDB" /tmp/screenshot_token.txt
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
  "$PY" -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir backend &
BACKEND_PID=$!

echo "==> Starting frontend on :5173..."
cd frontend
npx vite --port 5173 --host 127.0.0.1 --strictPort &
FRONTEND_PID=$!
cd ..

# Wait for backend and frontend to be ready.
echo "==> Waiting for services..."
until curl -sf http://127.0.0.1:8000/api/health > /dev/null 2>&1; do sleep 1; done
until curl -sf http://127.0.0.1:5173 > /dev/null 2>&1; do sleep 1; done
echo "    Both services ready."

echo "==> Capturing screenshots..."
cd frontend
SCREENSHOT_EMAIL="demo@example.com" SCREENSHOT_BASE_URL="http://localhost:5173" \
  npx playwright test --project=main e2e/screenshots.spec.ts 2>&1
cd ..

echo "==> Done. Screenshots:"
ls -la screenshots/*.png 2>/dev/null
