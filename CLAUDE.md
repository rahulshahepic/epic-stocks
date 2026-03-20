# CLAUDE.md

## Project Overview
Equity vesting tracker PWA. See SPEC.md for full requirements.

## Key Rules
- **backend/core.py is frozen.** Do not modify the core event generation logic. It is tested and verified. If you need to change event computation behavior, discuss first.
- **Events are never stored in the database.** They are computed on the fly from Grants + Loans + Prices via core.py.
- **backend/excel_io.py contains the Excel read/write logic.** Adapt as needed for the import/export endpoints but preserve the column mappings.
- **test_data/fixture.xlsx is a synthetic test fixture.** Use it to validate import logic. It contains no real data.
- **Schema migrations are lightweight.** `_migrate_schema()` in main.py adds missing columns on startup via ALTER TABLE. No heavy migration framework — keep it simple.
- **Encryption is per-user.** When `ENCRYPTION_MASTER_KEY` is set, `backend/crypto.py` handles AES-256-GCM column-level encryption via SQLAlchemy TypeDecorators. Transparent to routers and core.py.
- **Admin access is dynamic.** Set via `ADMIN_EMAIL` env var (semicolon-delimited). `is_admin` flag is set on every login — no persistent admin designation. Admin endpoints in `backend/routers/admin.py` never expose financial data.

## Tech Stack
- Backend: Python 3.12, FastAPI, SQLite (WAL mode), SQLAlchemy
- Frontend: React, TypeScript, Vite, Tailwind CSS, Recharts
- Deploy: Docker Compose + Caddy (auto-HTTPS)
- Auth: Google Sign-In (OAuth 2.0) → backend JWT session tokens

## Build Order
Follow the order in SPEC.md. Build backend first, then frontend. **Every step must include tests before moving on.** Ask before making architectural decisions.

## Testing Rules
- **No feature without tests.** Write tests alongside or before the implementation, not after.
- Backend: pytest. Use test_data/fixture.xlsx as a fixture for import/export tests.
- Frontend: Vitest + React Testing Library.
- E2E: Playwright, mobile viewport (375x812), chromium only.
- Known-good values for core logic validation: 89 events, final cum_shares=269843, cum_income=$144,325, cum_cap_gains=$1,243,695.

## CI/CD
- GitHub Actions runs tests on every push and PR.
- Deploy to VPS via SSH on push to main (after tests pass).
- See SPEC.md for full workflow definitions.

## Code Style
- Python: minimal comments, concise, no unnecessary abstractions
- TypeScript: functional components, hooks, Tailwind utility classes
- Mobile-first responsive design — this is primarily used on a phone

## Deployment Notes
- Caddy serves hashed assets (`/assets/*`) with immutable cache headers. `index.html`, `sw.js`, and `manifest.json` use `no-cache` for instant updates.
- The service worker (`frontend/public/sw.js`) uses `skipWaiting` + `clients.claim` and network-first navigation for cache busting.
- See PLAN.md for the privacy/encryption/admin roadmap and future plans (email notifications, security hardening).
