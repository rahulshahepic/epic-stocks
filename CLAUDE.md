# CLAUDE.md

## Project Overview
Equity vesting tracker PWA. See SPEC.md for full requirements.

## Key Rules
- **NEVER commit real Epic share prices to this repo.** Epic share prices (purchase prices, annual market prices, or any per-share dollar values from Epic's internal communications or SharePoint) are confidential company financial data. They must never appear in source code, test fixtures, comments, or any committed file. The onboarding wizard must NOT pre-fill or default any price fields — all price fields must start blank and be entered by the user at runtime.
- **backend/core.py is frozen.** Do not modify the core event generation logic. It is tested and verified. If you need to change event computation behavior, discuss first.
- **Events are never stored in the database.** They are computed on the fly from Grants + Loans + Prices via core.py.
- **backend/excel_io.py contains the Excel read/write logic.** Adapt as needed for the import/export endpoints but preserve the column mappings.
- **test_data/fixture.xlsx is a synthetic test fixture.** Use it to validate import logic. It contains no real data.
- **Schema migrations use Alembic.** Migrations live in `backend/alembic/versions/`. `alembic upgrade head` runs automatically in the lifespan on startup (PostgreSQL only; SQLite test environments use `create_all`). To create a new migration: `alembic revision --autogenerate -m "description"`.
- **Encryption is per-user.** When `KEY_ENCRYPTION_KEY` is set, `backend/scaffold/crypto.py` handles AES-256-GCM column-level encryption via SQLAlchemy TypeDecorators. Transparent to routers and core.py. Two-level hierarchy: KEK (env var, never changes) wraps the master key stored encrypted in `system_settings`; master key wraps per-user keys. `initialize_master_key()` is called from lifespan; `reload_master_key_if_stale()` is called from `EncryptionMiddleware` to auto-propagate rotations to all replicas within 5 seconds.
- **Admin access is dynamic.** Set via `ADMIN_EMAIL` env var (semicolon-delimited). `is_admin` flag is set on every login — no persistent admin designation. Admin endpoints in `backend/scaffold/routers/admin.py` never expose financial data.
- **OIDC_PROVIDERS format:** JSON array of provider objects. Required fields: `name`, `label`, `client_id`, `discovery_url`. Optional: `client_secret` (omit for PKCE-only clients), `scopes` (default `["openid","email","profile"]`), `subject_claim` (default `"sub"`; use `"oid"` for Azure Entra ID). Multiple providers show as separate login buttons. Redirect URI to register in IdP: `https://yourdomain.com/auth/callback`.

## Deployment Rules
- **Never fix production by running commands manually on the server.** Manual fixes get overridden by the next deploy and leave the repo out of sync with reality. Every fix must go through code → PR → merge → deploy.
- **The deploy script is the source of truth.** If something needs to happen on the server, it must be in `.github/workflows/deploy.yml`. If you find yourself saying "just run X on the server," stop and put X in the deploy script instead.

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
- **Auth provider config** — any change to OIDC provider support, PKCE flow, callback URI, or how `OIDC_PROVIDERS` is parsed: update the OIDC_PROVIDERS format section in README and FORK_GUIDE.md.
- **Deployment architecture** — any change to docker-compose topology, Caddy config, proxy network, or GitHub Actions secrets/vars: update the Production Deployment section in README and the GitHub Actions secrets table in OPERATIONS.md.
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

## Remaining Work

| Item | Notes |
|------|---------|
| **SSH: disable password auth** | Two lines in `sshd_config` + reload. See OPERATIONS.md §3. |
| **External uptime monitoring** | Configure UptimeRobot / Better Uptime / Cloudflare Health Checks for `/api/health`. Goal: SMS/email alert within 5 min. See OPERATIONS.md §5. |
| **Database backups** | Automated `pg_dump` off-site (S3/B2). Verify restore procedure. See OPERATIONS.md §6. |
| **Audit logging** | Log admin actions, failed auth attempts, data deletions to a DB table. Show in admin dashboard. |
| **DAST scanner in CI** | Add OWASP ZAP to GitHub Actions — scans the running app for vulnerabilities on every PR. |
| **Migration script** | Convert existing plaintext databases when enabling `KEY_ENCRYPTION_KEY` for the first time. |
| **PDF loan statement import** | OCR or structured template for importing loan data directly from Epic's PDF statements. Stretch goal. |

**Decided against:**
- JWT refresh tokens — 24hr access tokens + seamless Google re-auth is sufficient
- Client-side (zero-knowledge) encryption — would break server-side event computation, Excel export, and push notifications
