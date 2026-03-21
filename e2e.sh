#!/usr/bin/env bash
# Run E2E tests with all required services.
# Usage: ./e2e.sh [playwright args]
# Example: ./e2e.sh --grep "quick-flow"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TMPDB=$(mktemp /tmp/e2e-XXXXX.db)

cleanup() {
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  rm -f "$TMPDB"
}
trap cleanup EXIT

echo "==> Type-checking frontend..."
cd "$ROOT/frontend" && npx tsc -b --noEmit

echo "==> Starting backend on :8000..."
cd "$ROOT/backend" && \
  E2E_TEST=1 ADMIN_EMAIL=admin@e2e.test DATABASE_URL="sqlite:///$TMPDB" \
  python -m uvicorn main:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!

echo "==> Starting frontend on :5173..."
cd "$ROOT/frontend" && npx vite --port 5173 --host 127.0.0.1 --strictPort &
FRONTEND_PID=$!

echo "==> Waiting for services..."
for i in $(seq 1 20); do
  curl -sf http://localhost:8000/api/health > /dev/null 2>&1 && \
  curl -sf http://localhost:5173 > /dev/null 2>&1 && break
  sleep 1
done

echo "==> Running E2E tests..."
cd "$ROOT/frontend" && npx playwright test "$@"
