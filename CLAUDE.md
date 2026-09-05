# CLAUDE.md

## Project Overview
Equity vesting tracker PWA. See SPEC.md for full requirements.

## Key Rules
- **NEVER commit real Epic share prices to this repo.** Epic share prices (purchase prices, annual market prices, or any per-share dollar values from Epic's internal communications or SharePoint) are confidential company financial data. They must never appear in source code, test fixtures, comments, or any committed file. All price fields must start blank — never hard-code or default any price values. The wizard may use prices the user has already typed in earlier steps (e.g. pre-filling cost basis from the prices table), but no real price values may be embedded in code.
- **backend/core.py is frozen.** Do not modify the core event generation logic. It is tested and verified. If you need to change event computation behavior, discuss first.
- **Events are never stored in the database.** They are computed on the fly from Grants + Loans + Prices via core.py.
- **backend/excel_io.py contains the Excel read/write logic.** Adapt as needed for the import/export endpoints but preserve the column mappings.
- **test_data/fixture.xlsx is a synthetic test fixture.** Use it to validate import logic. It contains no real data.
- **test_data/epic_share_summary.csv and test_data/epic_loan_statement.txt are synthetic fixtures** in Epic's own share-summary and Stock Loan Statement formats, used by `backend/tests/test_epic_import.py`. The prices and balances in them are invented round numbers — never replace them with real Epic figures.
- **backend/app/epic_import/ imports Epic's own files** (share summary CSV, Stock Loan Statement PDF). **The server never calls an LLM.** When a parse fails its checks, `prompt.py` builds a brief the user pastes into their own assistant; whatever comes back is validated by the same checks in `draft.py`. Vest dates, periods, exercise dates and loan rates come from the content tables via `skeleton.py` — an import fills figures into that skeleton and may not change it. Only C1/C2 (statement vs. its own printed totals) block; everything else is advisory. Acceptance goes through the wizard, never a file. Keep the rule ids (G*, L*, P*, S1, C1-C11) stable — they are how import bugs get reported. `backend/app/epic_import/RULES.md` explains every id and is pinned to the code by tests in `test_epic_import.py`: adding a rule without an entry there, or leaving the diagnostics legend in `reconcile.py` without one, fails the suite. `backend/tests/test_epic_import_drift.py` is the format-drift suite: each case pins that the drift is detected with the right codes, that a corrected draft converges against the same mutated files, and that the prompt carries what a repair needs. Add a case there whenever Epic's format changes.
- **Problem reports never carry financial data.** `POST /api/report` (`backend/scaffold/routers/reports.py`) is open to anyone, signed in or not. It stores the message, route, source, `error_ref` and the error text the UI already showed; account, user agent and the client trail are attached **only** when the reporter ticks "include details", which is off by default and leaves the report anonymous even on an authenticated session. Never add a field that carries share counts, prices, loan amounts or computed figures — import reports send rule ids (`C1`, `G3`, …), never finding text, because that text quotes the user's own figures. Reports live in `user_reports`, not `error_logs`, because the nightly job trims `error_logs` to 500 rows. `error_ref` is minted by the global exception handler in `main.py`, returned in the 500 body, and is how a report finds its traceback.
- **Schema migrations use Alembic.** Migrations live in `backend/alembic/versions/`. `alembic upgrade head` runs automatically in the lifespan on startup (PostgreSQL only; SQLite test environments use `create_all`). To create a new migration: `alembic revision --autogenerate -m "description"`.
- **Encryption is per-user.** When `KEY_ENCRYPTION_KEY` is set, `backend/scaffold/crypto.py` handles AES-256-GCM column-level encryption via SQLAlchemy TypeDecorators. Transparent to routers and core.py. Two-level hierarchy: KEK (env var, never changes) wraps the master key stored encrypted in `system_settings`; master key wraps per-user keys. `initialize_master_key()` is called from lifespan; `reload_master_key_if_stale()` is called from `EncryptionMiddleware` to auto-propagate rotations to all replicas within 5 seconds.
- **Admin access is dynamic.** Set via `ADMIN_EMAIL` env var (semicolon-delimited). `is_admin` flag is set on every login — no persistent admin designation. Admin endpoints in `backend/scaffold/routers/admin.py` never expose financial data.
- **OIDC_PROVIDERS format:** JSON array of provider objects. Required fields: `name`, `label`, `client_id`, `discovery_url`. Optional: `client_secret` (omit for PKCE-only clients), `scopes` (default `["openid","email","profile"]`), `subject_claim` (default `"sub"`; use `"oid"` for Azure Entra ID), `prompt` (default `"select_account"` — keeps the IdP account chooser from being skipped; `""` omits it). Multiple providers show as separate login buttons. Redirect URI to register in IdP: `https://yourdomain.com/auth/callback`.

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

## Debugging CI Failures
- **Read CI logs with `curl`, not WebFetch.** WebFetch truncates large log files mid-build and never reaches the test output. Use:
  ```bash
  curl -s "<log-url>" | tail -c 30000
  ```
  The test failures appear at the end of the log (after the Docker build). `tail -c 30000` reliably skips the build noise and lands in the Playwright output.
- **Backend errors from E2E runs:** When Playwright tests fail, the CI workflow runs `docker compose logs e2e-app` automatically (the "Dump backend logs on failure" step). Look for that step in the GitHub Actions run — it contains full Python tracebacks including the SQL, parameters, and exception type. Do not put exception details in HTTP response bodies; keep them in server logs.
- **`loginAs` failures:** If `POST /api/auth/test-login` returns non-2xx, check the backend logs first. Common causes: `DatatypeMismatch` (passing Python bool to an INTEGER column — always use `int(...)`), `IntegrityError` from a concurrent insert race (handled by the retry loop in `test_login`), or a missing `E2E_TEST=1` env var (endpoint not registered).

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
- **How:** Run `./screenshots/run.sh` from the repo root. **You can and should run this in your current environment** — it works in Claude Code web sessions. It spins up a temp backend + frontend, seeds sample data, and runs `frontend/e2e/screenshots.spec.ts` via Playwright to capture all screenshots into `screenshots/`. The script is self-contained — do not try to start servers manually or run `npx playwright test` directly.
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
- JWT refresh tokens — 30-day access tokens + seamless Google re-auth on expiry is sufficient (PWA-friendly)
- Client-side (zero-knowledge) encryption — would break server-side event computation, Excel export, and push notifications
