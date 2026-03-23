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
- Deploy: Docker Compose + Caddy (auto-HTTPS), Cloudflare in front for DDoS/rate limiting
- Auth: Google Sign-In (OAuth 2.0) → backend JWT session tokens (24hr expiry, no refresh tokens)
- Email: Resend API (`RESEND_API_KEY` env var)

## Build Order
Follow the order in SPEC.md. Build backend first, then frontend. **Every step must include tests before moving on.** Ask before making architectural decisions.

## Testing Rules
- **No feature without tests.** Write tests alongside or before the implementation, not after.
- Backend: pytest. Use test_data/fixture.xlsx as a fixture for import/export tests.
- Frontend: Vitest + React Testing Library.
- E2E: Playwright, mobile viewport (375x812), chromium only.
- **Always run `npx tsc -b --noEmit` before committing frontend changes.** The dev server skips type-checking; CI catches it.
- **Run E2E tests via `./e2e.sh` from the repo root.** This script handles type-checking, starting a fresh backend + Vite server, waiting for both to be healthy, and cleanup. Do not manually spin up servers and run Playwright separately.
- Known-good values for core logic validation: 89 events, final cum_shares=558500, cum_income=$144,325, cum_cap_gains=$1,224,195. (cum_shares was 269843 before Loan Payoff refactor; was 571500 before fixture dp_shares updated from -2000 to -15000.)

## CI/CD
- GitHub Actions runs tests on every push and PR.
- Deploy to VPS via SSH on push to main (after tests pass).
- See SPEC.md for full workflow definitions.

## Code Style
- Python: minimal comments, concise, no unnecessary abstractions
- TypeScript: functional components, hooks, Tailwind utility classes
- Mobile-first responsive design — this is primarily used on a phone

## README Documentation Checklist
> **⚠️ MANDATORY: Update README.md whenever any of the following change. DO NOT ship a feature without updating the docs.**

- **User-facing features** — new pages, workflows, or settings a user would interact with: update the "How to use" / getting started section of the README.
- **Admin workflows** — new env vars, admin endpoints, operational procedures (e.g. notifications, user management, blocked users): update the admin/ops section of the README.
- **Code structure** — new routers, models, services, frontend pages, or hooks added: update the architecture/code structure section of the README.
- **Environment variables** — any new `SOME_VAR` required or optional: document it in the README env var table.
- **What to update in README.md:**
  1. Feature description / how to use it (user perspective)
  2. Admin/ops notes if it affects deployment or server config
  3. Code structure diagram or file list if new files were added
  4. Any new env vars with description and whether they are required

## UI Change Checklist
> **⚠️ MANDATORY AFTER EVERY UI CHANGE: Run `./screenshots/run.sh` and commit the updated screenshots. DO NOT skip this. DO NOT forget. This is not optional.**

- **ALWAYS update README screenshots after any UI change** — login page, dashboard, import, settings, any page.
- **How:** Run `./screenshots/run.sh` from the repo root. This spins up a temp backend + frontend, seeds sample data, and runs `frontend/e2e/screenshots.spec.ts` via Playwright to capture all screenshots into `screenshots/`.
- **What to capture:** The spec captures dashboard (light/dark × mobile/desktop) and admin (light/dark × mobile). Add new test cases to the spec when adding new pages.
- **README:** After capturing, update `README.md` to reference any new screenshot files.

## Deployment Notes
- Caddy serves hashed assets (`/assets/*`) with immutable cache headers. `index.html`, `sw.js`, and `manifest.json` use `no-cache` for instant updates.
- The service worker (`frontend/public/sw.js`) uses `skipWaiting` + `clients.claim` and network-first navigation for cache busting.
- See PLAN.md for the full feature roadmap (encryption, admin, sales, notifications — most now implemented).
- See SECURITY_HARDENING.md for what's in the app vs. what requires hosting environment setup.
