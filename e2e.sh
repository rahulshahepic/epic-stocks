#!/usr/bin/env bash
# Run E2E tests via Docker Compose.
# Usage: ./e2e.sh [playwright args — passed via PLAYWRIGHT_ARGS env var or appended to CMD]
#
# Requires Docker with the Compose plugin. No local Python, Node, or Postgres needed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Type-checking frontend..."
cd "$ROOT/frontend" && npx tsc -b --noEmit

# The existing screenshot runner owns the temporary servers and their cleanup.
# Opt in on machines without Docker; the normal CI path is unchanged.
if [[ "${E2E_LOCAL:-0}" == "1" ]]; then
  cd "$ROOT"
  PLAYWRIGHT_SPECS="${PLAYWRIGHT_SPECS:-e2e/plugin-ui.spec.ts}" ./screenshots/run.sh
  exit $?
fi

echo "==> Running E2E tests in Docker..."
cd "$ROOT"
docker compose -f docker-compose.e2e.yml up --build --abort-on-container-exit --exit-code-from playwright
EXIT=$?
docker compose -f docker-compose.e2e.yml down -v
exit $EXIT
