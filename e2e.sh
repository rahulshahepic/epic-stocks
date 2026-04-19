#!/usr/bin/env bash
# Run E2E tests locally. Backend + Postgres come up in Docker Compose;
# Playwright runs on the host against http://localhost:8000.
# Requires: docker (with the compose plugin) and node.
# Usage: ./e2e.sh [additional playwright args]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Type-checking frontend..."
cd "$ROOT/frontend" && npx tsc -b --noEmit

echo "==> Starting backend + db..."
cd "$ROOT"
docker compose -f docker-compose.e2e.yml up -d --build e2e-db e2e-app

cleanup() {
  docker compose -f docker-compose.e2e.yml down -v
}
trap cleanup EXIT

echo "==> Waiting for backend health..."
for _ in $(seq 1 60); do
  if curl -sf http://localhost:8000/api/health >/dev/null; then
    echo "Backend ready."
    break
  fi
  sleep 1
done

echo "==> Running playwright tests..."
cd "$ROOT/frontend"
E2E_BASE_URL=http://localhost:8000 E2E_API_URL=http://localhost:8000 npx playwright test "$@"
