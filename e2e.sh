#!/usr/bin/env bash
# Run E2E tests with all required services.
# Usage: ./e2e.sh [playwright args]
# Example: ./e2e.sh --grep "quick-flow"
#
# Requires a local PostgreSQL instance. DATABASE_URL defaults to:
#   postgresql://postgres:postgres@localhost:5432/vesting_e2e
# Override via E2E_DATABASE_URL env var.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
E2E_DB="${E2E_DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/vesting_e2e}"

cleanup() {
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  # Drop the e2e database to leave a clean state
  psql "${E2E_DB%/*}/postgres" -c "DROP DATABASE IF EXISTS vesting_e2e;" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> Creating e2e database..."
psql "${E2E_DB%/*}/postgres" -c "DROP DATABASE IF EXISTS vesting_e2e; CREATE DATABASE vesting_e2e;" 2>/dev/null

echo "==> Type-checking frontend..."
cd "$ROOT/frontend" && npx tsc -b --noEmit

echo "==> Clearing ports 8000 and 5173..."
fuser -k 8000/tcp 5173/tcp 2>/dev/null || true
sleep 1

echo "==> Starting backend on :8000..."
cd "$ROOT/backend" && \
  E2E_TEST=1 ADMIN_EMAIL=admin@e2e.test DATABASE_URL="$E2E_DB" \
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
