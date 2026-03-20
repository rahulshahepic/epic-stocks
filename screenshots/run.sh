#!/usr/bin/env bash
# Capture README screenshots with a temporary database.
# Run from the repo root: ./screenshots/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."

cleanup() {
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  rm -f "$TMPDB" /tmp/screenshot_token.txt
}
trap cleanup EXIT

TMPDB=$(mktemp /tmp/screenshots-XXXXX.db)

echo "==> Seeding temporary database..."
DATABASE_URL="sqlite:///$TMPDB" python screenshots/seed.py > /tmp/screenshot_token.txt
TOKEN=$(cat /tmp/screenshot_token.txt)

echo "==> Starting backend on :8000..."
DATABASE_URL="sqlite:///$TMPDB" GOOGLE_CLIENT_ID="demo.apps.googleusercontent.com" \
  python -m uvicorn main:app --host 127.0.0.1 --port 8000 --app-dir backend &
BACKEND_PID=$!
sleep 2

echo "==> Starting frontend on :5173..."
cd frontend
npx vite --port 5173 --host 127.0.0.1 &
FRONTEND_PID=$!
cd ..
sleep 3

echo "==> Capturing screenshots..."
cd frontend
SCREENSHOT_TOKEN="$TOKEN" SCREENSHOT_BASE_URL="http://localhost:5173" \
  npx playwright test --project=chromium 2>&1
cd ..

echo "==> Done. Screenshots:"
ls -la screenshots/*.png 2>/dev/null
