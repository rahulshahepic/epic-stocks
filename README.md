# Equity Vesting Tracker

A multi-user PWA for tracking equity compensation: grants, vesting schedules, stock loans, share price history, and derived event timelines showing income vs capital gains over time.

## Screenshots

### Import Flow

| Upload | Confirm | Success |
|--------|---------|---------|
| ![Import Page](screenshots/01-import-page.png) | ![Import Confirm](screenshots/02-import-confirm.png) | ![Import Success](screenshots/03-import-success.png) |

### Dashboard

| | Light | Dark |
|--|-------|------|
| **Mobile** | ![Dashboard Light Mobile](screenshots/dashboard-light-mobile.png) | ![Dashboard Dark Mobile](screenshots/dashboard-dark-mobile.png) |
| **Desktop** | ![Dashboard Light Desktop](screenshots/dashboard-light-desktop.png) | ![Dashboard Dark Desktop](screenshots/dashboard-dark-desktop.png) |

### Events Timeline

| Light | Dark |
|-------|------|
| ![Events Light Mobile](screenshots/events-light-mobile.png) | ![Events Dark Mobile](screenshots/events-dark-mobile.png) |

### Import / Export (Template + Upload + Download)

![Import Export](screenshots/import-export-mobile.png)

### Stock Sales

| Light | Dark |
|-------|------|
| ![Sales Light Mobile](screenshots/sales-light-mobile.png) | ![Sales Dark Mobile](screenshots/sales-dark-mobile.png) |

### Settings (Tax Rates, Lot Selection, Down Payment & Exit Planning)

| Light | Dark |
|-------|------|
| ![Settings Light](screenshots/settings-light-mobile.png) | ![Settings Dark](screenshots/settings-dark-mobile.png) |

### Admin Dashboard

| Light | Dark |
|-------|------|
| ![Admin Light](screenshots/admin-light-mobile.png) | ![Admin Dark](screenshots/admin-dark-mobile.png) |

### Login & Privacy Policy

| Light | Dark |
|-------|------|
| ![Login Light Mobile](screenshots/login-light-mobile.png) | ![Login Dark Mobile](screenshots/login-dark-mobile.png) |

![Privacy Policy](screenshots/privacy-light-mobile.png)

## Getting Started (User Guide)

1. **Sign in** — use any Google account. Your data is tied to that account, and you can export everything anytime.
2. **Add a price** — go to **Prices** and enter the current share price (Epic announces this each March). Without at least one price, no events will be computed.
3. **Add your data** — two options:
   - **Import from Excel** — go to **Import**, download the **Sample** (pre-filled with fake data and explanatory cell comments) to see what the format looks like, then fill in your real data and upload. Click "What do the columns mean?" for a plain-English guide to every field.
   - **Add manually** — go to **Grants** and add grants one by one. Then add any **Loans** and their annual interest loans. For bonus/free grants where you filed an **83(b) election**, tick the "Filed 83(b) election" checkbox — vesting events will show unrealized cap gains instead of ordinary income.
4. **View the Dashboard** — summary cards (share price, total shares, income, cap gains, loan principal, interest, tax paid, cash received, next event). Use the **As of** date picker to time-travel. **Today** snaps to the current date; **Last event** jumps to your final vesting date; **Exit date** appears when you've configured one (see Settings → Exit Planning) and jumps to your projected liquidation date — showing 0 shares, 0 principal, and net cash.
5. **View Events** — the full computed timeline of vesting, exercise, loan payoff, and sale events. A **Liquidation (projected)** event is automatically appended at your exit date. Tap it to see the calculation breakdown (shares × price → gross proceeds → est. tax → net). Events after the exit date are dimmed with a "beyond exit horizon" separator.
6. **Configure your exit date** — go to **Settings → Exit Planning** to set a specific date. The projected liquidation uses shares and price as of that date (even if it's before your last vesting event). Defaults to your last vesting date if not set.
7. **Record a sale** — go to **Sales**, add a sale. The lot selection method (LIFO/FIFO/same-tranche) and tax rates are set in **Settings → Tax Rates**. For a loan payoff sale, link it to a loan and the share count is auto-sized to cover the full payoff after tax.
8. **Set up notifications** — go to **Settings → Notifications**. Enable push (browser) or email, then choose timing: day-of, 3 days before, or 1 week before your events. Hit **Send test** to confirm push is working.
9. **Export your data** — go to **Import/Export → Download Vesting.xlsx** to get a full export at any time.

## Features

- **Event Timeline** — computed on the fly from grants, prices, and loans. Never stored. Shows income, capital gains, share price, and cumulative totals. A **Liquidation (projected)** event is auto-injected at the exit date: tap it to see a breakdown (shares × price → gross proceeds → est. tax → net). Events after the exit date are dimmed with a "beyond exit horizon" separator so it's clear they won't occur if you liquidate.
- **Exit Planning** — set an exit date in Settings → Exit Planning to project a full liquidation at any point, even before your last vesting event. The projection uses only the shares and price available as of that date. Dashboard quick buttons update to include an **Exit date** shortcut; card values at the exit date correctly show 0 shares, 0 loan principal, and net cash (gross proceeds − loans − tax).
- **Dashboard** — summary cards (share price, total shares, income, cap gains, loan principal, total interest, tax paid, cash received, next event) with an **As of** date picker and quick buttons: **Today**, **Last event** (final vesting date), and **Exit date** (when configured). Interactive charts include an Interest Over Time chart with guaranteed vs. projected interest-on-interest layers. Empty state shows getting-started prompts for new users.
- **Stock Sales** — record share sales with configurable lot selection (LIFO/FIFO/same-tranche), LT/ST capital gains split, and Wisconsin tax calculator. Payoff sales can be linked to loans and auto-sized to cover the cash due after tax (gross-up calculation). Use "Regen payoff sales" on the Loans page to recompute all future payoff sale share counts after changing lot selection.
- **CRUD Management** — full create/read/update/delete for Grants, Loans, Prices, and Sales.
- **Quick Flows** — convenience endpoints: "New Purchase" (grant + loan with optional stock down payment), "Annual Price", "Add Bonus".
- **83(b) Election Support** — bonus/free grants can be flagged as having an 83(b) election filed. Vesting events for these grants show unrealized cap gains (violet `~$X`) instead of ordinary income, with a tappable card explaining the cost basis and potential LT cap gains tax at eventual sale.
- **Down Payment Rules** — configurable minimum DP policy (percent of purchase and dollar cap). "Prefer stock DP" auto-calculates the minimum stock exchange down payment on new purchases. Default: 10% or $20,000, whichever is lower.
- **Excel Import/Export** — bootstrap from an existing Vesting.xlsx or export current state. The Import page includes a downloadable sample file (pre-filled with fake data, with cell comments explaining every field) and a built-in column reference guide.
- **Google Sign-In** — OAuth 2.0 authentication, automatic account creation. Any Google account works; data is tied to that account.
- **Admin Dashboard** — user management, aggregate stats, email blocking, and system health monitoring (CPU, RAM, DB size sparklines with 24h/72h/7d/30d windows, per-table DB size breakdown). Admin cannot see financial data.
- **Push & Email Notifications** — configurable advance timing: day-of, 3 days before, or 1 week before each event. Per-user opt-in for each channel independently. Includes a "Send test" button to confirm push is working.
- **Per-User Encryption** — AES-256-GCM column-level encryption. The master key is auto-generated on first deploy and stored on-disk; it never passes through GitHub Secrets. Each user gets a unique key. Admins can rotate the master key live from the admin panel with automatic rollback on failure.
- **Maintenance Mode** — two distinct mechanisms: (1) app-managed downtime for key rotation and admin-toggled maintenance (app stays up, financial API routes return 503, auth and admin remain accessible; an amber banner appears in the nav and financial pages show a placeholder); (2) deploy-time full downtime via a Caddy sentinel file (static 503 page while the app container is stopped).
- **Dark/Light Mode** — auto-detects system preference, updates live.
- **Mobile-First** — designed for 375px phone viewports.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy, PostgreSQL (Alembic migrations) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Recharts |
| Auth | Google Sign-In (OAuth 2.0) → backend JWT session tokens |
| Deploy | Docker Compose + Caddy (auto-HTTPS) + Cloudflare (DDoS/WAF) |
| Tests | pytest (backend), Vitest + RTL (frontend), Playwright (E2E) |

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+
- A Google OAuth Client ID ([create one here](https://console.cloud.google.com/apis/credentials))

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The backend creates `data/vesting.db` automatically on first run. To reset the local database, delete the file: `rm backend/data/vesting.db`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` requests to `localhost:8000`.

### Environment Variables

Copy the example file and fill in your secrets:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | Yes | Random secret for signing JWT tokens |
| `GOOGLE_CLIENT_ID` | Yes | From [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `DATABASE_URL` | Yes (prod) | PostgreSQL DSN, e.g. `postgresql://postgres:pass@localhost:5432/vesting`. Docker Compose sets this automatically. |
| `POSTGRES_PASSWORD` | Yes (prod) | Password for the `postgres` user in the Docker Compose `db` service |
| `PRIVACY_URL` | No | Override the privacy policy link on the login page (defaults to the built-in `/privacy` page) |
| `ADMIN_EMAIL` | No | Semicolon-delimited email(s) granted admin access on login |
| `VAPID_PUBLIC_KEY` | No | Required for push notifications |
| `VAPID_PRIVATE_KEY` | No | Required for push notifications |
| `VAPID_CLAIMS_EMAIL` | No | Contact email embedded in push requests (e.g. `mailto:admin@yourdomain.com`) |
| `RESEND_API_KEY` | No | Enables email notifications via [Resend](https://resend.com) |
| `RESEND_FROM` | No | Sender address for emails (e.g. `Equity Tracker <noreply@yourdomain.com>`) |
| `APP_URL` | No | Public app URL included as a link in email notifications |

> **Encryption master key** — `ENCRYPTION_MASTER_KEY` is **not** an environment variable you set. On first deploy the script generates a 256-bit key with `openssl rand -hex 32` and writes it to `./data/current_master_key` on the VPS. It lives on-disk only — never in GitHub Secrets. The app always reads the key from this file. After a key rotation the file is updated automatically; no deploy or secret change is needed.

**Generating VAPID keys** (one-time, requires Node):
```bash
npx web-push generate-vapid-keys
```

The frontend fetches the Google Client ID from the backend at `/api/config` — no separate frontend env var needed.

## Production Deployment

### Docker Compose

```bash
cp .env.example .env   # fill in secrets
docker compose up -d
```

This starts the FastAPI app + Caddy reverse proxy with auto-HTTPS.

### Manual VPS Setup

```bash
# One-time setup on the VPS
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/epic-stocks/data
cd /opt/epic-stocks
git clone <repo-url> .
```

Secrets are managed via GitHub Actions secrets — the deploy workflow writes `.env` automatically on every push to `main`. Never create `.env` on the VPS manually.

### Deploy Safety

The deploy workflow includes two safeguards against silent failures:

1. **Caddy config validation** — a `caddy-validate` job runs before deploy, catching any Caddyfile syntax errors introduced by new Caddy versions (`caddy:2` is intentionally unpinned so CI catches breaking changes before they reach prod).
2. **Post-deploy health polling** — after `docker compose up -d`, the deploy script polls `http://localhost/api/health` for up to 60 seconds. If the app doesn't respond, it prints `docker compose ps`, recent logs, recent commits, and manual rollback instructions, then exits 1. No auto-rollback — Alembic runs migrations on startup, so reverting code after a schema migration requires manual review.

**Downtime during deploy** — the deploy script touches `./data/full_maintenance` before stopping the app container. Caddy serves a static "Down for Maintenance" page (auto-refreshes every 20 s, `Cache-Control: no-store`) until the sentinel is removed at the end of the script. This is separate from app-managed maintenance (rotation / admin toggle), which uses `./data/maintenance` and keeps the app running.

For the full deploy pipeline details, uptime monitoring setup, backup strategy, and incident runbook, see **[OPERATIONS.md](OPERATIONS.md)**.

## Development

### Running Tests

```bash
# Backend unit tests (from repo root)
pytest backend/tests/ -v

# Frontend unit tests
cd frontend && npm test

# Frontend unit tests — watch mode (re-runs on file save)
cd frontend && npm run test:watch

# Lint frontend
cd frontend && npm run lint

# All unit tests
pytest backend/tests/ -v && cd frontend && npm test
```

### Running E2E Tests

E2E tests use Playwright. First-time setup:

```bash
cd frontend && npm ci && npx playwright install chromium
```

Then use the script from the repo root — it handles type-checking, spinning up a fresh backend + frontend, waiting for both to be healthy, and cleaning up on exit:

```bash
./e2e.sh
```

To pass Playwright args (filter, reporter, etc.):
```bash
./e2e.sh --grep "quick-flow"
./e2e.sh e2e/user-journey.spec.ts
./e2e.sh --reporter=list
```

### Regenerating Screenshots

First-time setup:

```bash
cd backend && pip install -r requirements.txt
cd frontend && npm ci && npx playwright install chromium
```

Then from the repo root:

```bash
./screenshots/run.sh
```

This spins up a temporary backend + frontend with seeded sample data, runs all Playwright specs (including screenshot capture), and writes PNGs to `screenshots/`. Commit any updated screenshots to the repo.

### Project Structure

```
epic-stocks/
├── backend/
│   ├── main.py              # FastAPI app + schema migration + metrics sampler
│   ├── core.py              # Event generation logic (frozen)
│   ├── sales_engine.py      # FIFO cost-basis + tax + gross-up calculations
│   ├── models.py            # SQLAlchemy models (User, Grant, Loan, Price, Sale, SystemMetric, etc.)
│   ├── database.py          # SQLAlchemy engine setup (PostgreSQL in production, SQLite for tests)
│   ├── alembic/             # Alembic migrations (run on startup)
│   ├── auth.py              # JWT + Google OAuth + admin checks
│   ├── crypto.py            # Per-user AES-256-GCM encryption
│   ├── maintenance.py       # Shared sentinel path for app-managed downtime
│   ├── excel_io.py          # Excel read/write (openpyxl)
│   ├── schemas.py           # Pydantic schemas
│   ├── notifications.py     # Push + email notification logic
│   ├── routers/
│   │   ├── auth_router.py   # Google login, JWT issuance
│   │   ├── grants.py        # Grant CRUD + bulk
│   │   ├── loans.py         # Loan CRUD + bulk
│   │   ├── prices.py        # Price CRUD
│   │   ├── events.py        # Computed timeline + dashboard
│   │   ├── horizon.py       # Exit date settings (projected liquidation)
│   │   ├── flows.py         # Quick flows (new purchase, bonus, price)
│   │   ├── import_export.py # Excel import/export + template
│   │   ├── sales.py         # Sales CRUD + tax breakdown
│   │   ├── push.py          # Push notification subscriptions
│   │   ├── notifications.py # Email notification preferences
│   │   └── admin.py         # Admin dashboard, user mgmt, blocklist
│   └── tests/               # pytest tests
├── frontend/
│   ├── src/
│   │   ├── pages/           # Login, PrivacyPolicy (public), Dashboard, Events, Grants, Loans, Prices, etc.
│   │   ├── components/      # Layout shell, shared UI
│   │   ├── hooks/           # useAuth, useApiData, useDark, usePush, etc.
│   │   └── __tests__/       # Vitest tests
│   ├── public/
│   │   ├── sw.js            # Service worker (cache busting + push)
│   │   └── manifest.json    # PWA manifest
│   ├── e2e/                 # Playwright specs
│   └── playwright.config.ts
├── screenshots/             # Auto-generated by Playwright
│   ├── run.sh               # Screenshot capture orchestrator
│   └── seed.py              # Sample data seeder
├── Caddyfile                # Reverse proxy + cache headers
├── Dockerfile               # Multi-stage build (frontend + backend)
├── docker-compose.yml       # App + Caddy
└── test_data/
    └── fixture.xlsx         # Synthetic test fixture
```

## API Overview

All endpoints require `Authorization: Bearer <jwt>` except auth, health, status, config, and import template.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/google` | Exchange Google ID token for JWT |
| GET | `/api/me` | Current user info + is_admin flag |
| POST | `/api/me/reset` | Reset all financial data (keeps account) |
| DELETE | `/api/me` | Delete account and all associated data |
| GET | `/api/config` | Client config (Google client ID, VAPID key, etc.) |
| GET | `/api/health` | Health check (infra/uptime monitors — always 200) |
| GET | `/api/status` | Operational status `{"maintenance": bool}` — polled by SPA |
| GET | `/api/dashboard` | Summary cards data |
| GET | `/api/events` | Computed event timeline |
| GET/POST | `/api/grants` | List/create grants |
| GET/PUT/DELETE | `/api/grants/{id}` | Get/update/delete grant |
| POST | `/api/grants/bulk` | Bulk create grants |
| GET/POST | `/api/loans` | List/create loans |
| GET/PUT/DELETE | `/api/loans/{id}` | Get/update/delete loan |
| POST | `/api/loans/bulk` | Bulk create loans |
| GET/POST | `/api/prices` | List/create prices |
| GET/PUT/DELETE | `/api/prices/{id}` | Get/update/delete price |
| GET/POST | `/api/sales` | List/create sales |
| GET/PUT/DELETE | `/api/sales/{id}` | Get/update/delete sale |
| GET | `/api/sales/{id}/tax-breakdown` | FIFO tax breakdown for a sale |
| GET | `/api/loans/{id}/payoff-sale-suggestion` | Suggested gross-up sale for a loan |
| POST | `/api/loans/regenerate-all-payoff-sales` | Recompute all future payoff sale share counts |
| GET/POST | `/api/loan-payments` | List/create early loan payments |
| PUT/DELETE | `/api/loan-payments/{id}` | Update/delete a loan payment |
| POST | `/api/flows/new-purchase` | Create grant + optional loan |
| POST | `/api/flows/annual-price` | Add a price entry |
| POST | `/api/flows/add-bonus` | Add a bonus grant |
| POST | `/api/import/excel` | Upload Excel file to populate tables |
| GET | `/api/import/template` | Download empty Excel template |
| GET | `/api/import/sample` | Download sample Excel file pre-filled with fake data and cell comments |
| GET | `/api/export/excel` | Download Vesting.xlsx with all data |
| GET/PUT | `/api/horizon-settings` | Get/set exit date for projected liquidation |
| POST/DELETE | `/api/push/subscribe` | Subscribe/unsubscribe push notifications |
| GET | `/api/push/status` | Check push subscription status |
| POST | `/api/push/test` | Send a test push notification to the current user's subscriptions |
| GET/PUT | `/api/notifications/email` | Get/set email notification preference (returns `enabled` + `advance_days`) |
| PUT | `/api/notifications/advance-days` | Set how many days in advance to send notifications (0 = day-of, 3, or 7) |
| GET/POST | `/api/admin/maintenance` | Get/set app-managed maintenance mode (admin only) |
| GET | `/api/admin/rotation-status` | Whether a rotation snapshot exists on disk (admin only) |
| POST | `/api/admin/rotate-key` | SSE stream: rotate encryption master key (admin only) |
| POST | `/api/admin/rotation-restore` | Restore DB from on-disk snapshot after a crashed rotation (admin only) |
| GET | `/api/admin/stats` | Aggregate stats + latest CPU/RAM snapshot (admin only) |
| GET | `/api/admin/users?q=&limit=10&offset=0` | User list with metadata, searchable + paginated (admin only) |
| DELETE | `/api/admin/users/{id}` | Delete user + all data (admin only) |
| GET/POST | `/api/admin/blocked` | List/block emails (admin only) |
| DELETE | `/api/admin/blocked/{id}` | Unblock email (admin only) |
| POST | `/api/admin/test-notify` | Send a test push/email notification to any user (admin only) |
| GET | `/api/admin/errors` | List recent backend error logs (admin only) |
| DELETE | `/api/admin/errors` | Clear error log (admin only) |
| GET | `/api/admin/metrics?hours=72` | Time-series CPU/RAM/DB metrics history (admin only) |
| GET | `/api/admin/db-tables` | Per-table DB size breakdown (PostgreSQL only, admin only) |

## Admin Workflows

The admin system is opt-in via the `ADMIN_EMAIL` environment variable. Admins are designated dynamically on each login — adding or removing an email from `ADMIN_EMAIL` grants or revokes access on the user's next login.

### Accessing the Admin Dashboard

1. Set `ADMIN_EMAIL` in your `.env` (semicolon-delimited for multiple admins)
2. Log in with a matching Google account
3. Navigate to `/admin` in the app

### What Admins Can See

- Total registered users and active users (last 30 days)
- Aggregate counts: total grants, loans, prices across all users
- Database storage usage
- **System Health** — current CPU %, RAM %, and DB size with sparkline charts (24h/72h/7d/30d windows). Sampled every 15 minutes; 30-day rolling retention.
- **Database Tables** — per-table size breakdown showing which tables are large (PostgreSQL only). Useful for diagnosing storage growth; includes a note explaining PostgreSQL's ~7–8 MB baseline overhead.
- Per-user metadata: email, name, created_at, last_login, record counts, admin badge
- Searchable user list (filter by email or name) with pagination, sorted by last active

### What Admins Cannot See

- Any user's financial data (share counts, prices, loan amounts, computed events)
- Only aggregate counts and user metadata are exposed

### Admin Actions

| Action | Description |
|--------|-------------|
| **Delete user** | Permanently removes user and all their data. Blocked during maintenance (financial data unreadable mid-rotation). Admin users cannot be deleted. |
| **Block email** | Prevents an email address from logging in or creating an account. Includes optional reason field. |
| **Unblock email** | Removes an email from the blocklist, restoring login access. |
| **View user activity** | See when each user last logged in and how many records they have. |
| **Send test notification** | Immediately sends a push and/or email notification to any user for debugging. |
| **Enable / disable maintenance** | Toggles app-managed downtime. Financial API routes return 503; auth and admin remain accessible. An amber banner appears in the nav and financial pages show a placeholder. Use this before planned ops that affect financial data. |
| **Rotate encryption key** | Generates a new master key, re-wraps all per-user keys, smoke-tests, persists to disk, then clears maintenance. New key is live immediately — no deploy needed. Snapshot of old keys is written to disk before any changes; restored automatically on failure. All admins are emailed if rotation fails. |
| **Restore from snapshot** | Appears in the admin panel when an interrupted rotation left a snapshot file on disk. Writes the old per-user keys back to the DB and clears maintenance — recovers from a crash without SSH access. |

### Blocked Email System

Blocked emails are checked at login time (case-insensitive). A blocked user cannot log in or create a new account. The blocklist is managed via the admin panel or the `/api/admin/blocked` endpoints.

## Notifications

Notifications are sent once per day, at 7 AM UTC. Each user can configure how far in advance to be notified — day-of, 3 days before, or 1 week before their events. The scheduler checks events falling on `today + advance_days` for each user.

**Which events trigger a notification:**
| Event type | Notified? |
|---|---|
| Vesting | Yes |
| Exercise | Yes |
| Loan Payoff | Yes |
| Planned sale (loan payoff) | Yes |
| Share Price update | No |
| Down payment exchange | No |

**What the notification contains:**
Notifications are intentionally minimal — they contain no financial data, no share counts, and no dollar amounts. The content is identical across push and email:

- **Push notification** — a single notification with title `Equity Tracker` and a body like: `You have 2 events today: 1 Loan Repayment, 1 Vesting`. Tapping it opens the app dashboard.
- **Email** — subject: `Equity Tracker: 2 events today`. Body: the same event count summary plus a link prompt to log in and view details.

If a user has multiple events of the same type on the same day they are counted together (`2 Vesting`). Users open the app to see the full details.

**At-most-once-per-day guarantee:** A `last_notified_at` timestamp on each user ensures only one batch is sent per day regardless of server restarts or retries.

**Opt-in per channel:**
- *Push* — enabled by subscribing in the browser (Settings → Notifications → Enable). Requires VAPID keys to be configured. Each device subscribes independently; all active devices receive the notification. A **Send test** button in Settings lets users confirm push is working without waiting for a real event.
- *Email* — enabled via the toggle in Settings. Requires `RESEND_API_KEY` to be configured. Disabled by default.

**Advance timing** — users choose when to receive notifications: day-of (default), 3 days before, or 1 week before the event. This is set in Settings → Notifications and applies to both push and email.

**Admin test tool:** Admins can send an immediate test notification to any user from the Admin panel, using either a pre-built event template (Vesting, Exercise, Loan Repayment) or fully custom title/body. Test notifications respect user preferences — push only goes to active subscriptions, email only if the user has it enabled.

## Privacy & Data Security

This application stores sensitive financial data. Please read **[PRIVACY.md](PRIVACY.md)** before deploying for others.

Key points:
- **Data isolation** — every API query filters by authenticated user ID. Users cannot see each other's data.
- **Encryption at rest** — financial data (shares, prices, loan amounts) is encrypted per-user with AES-256-GCM. The master key is auto-generated on first deploy and stored at `./data/current_master_key` on the VPS — it never appears in GitHub Secrets or CI logs. Each user gets a unique key wrapped by the master key; rotating the master key re-wraps only the key wrappers, not all the data. See [PLAN.md](PLAN.md) for details.
- **Open source** — users can audit the code, self-host their own instance, or fork the project.
- **Data portability** — users can export all their data to Excel at any time.

If you run an instance for others: secure the database file, use HTTPS, set `ENCRYPTION_MASTER_KEY`, and keep your secrets safe. See **[OPERATIONS.md](OPERATIONS.md)** for a full checklist of what the app does automatically vs. what you need to configure in your hosting environment (Cloudflare, SSH hardening, VPS firewall, backups, runbook).

## Key Design Decisions

- **Events are never stored.** They're computed per-request from the three source tables (Grants, Loans, Prices). This eliminates sync issues entirely.
- **core.py is frozen.** The event generation logic is tested against known-good values (89 events, cum_shares=558,500, cum_income=$144,325, cum_cap_gains=$1,224,195). Don't modify it.
- **Excel import is per-sheet, not all-or-nothing.** Only the sheets present in the uploaded file are replaced (Schedule → grants, Loans → loans + payoff sales, Prices → prices). Sheets not included in the file are left untouched. The import flow validates first, previews second, writes third — all in one transaction. A backup snapshot of the affected data is saved automatically before each import (last 3 kept per user). Restore via `GET /api/import/backups` + `POST /api/import/backups/{id}/restore`.
- **Lot selection method is user-configurable (default: LIFO).** In Tax Settings, users choose between:
  - **LIFO** (default) — newest vested lots sold first. For rising stock this maximises cost basis and minimises cap gains.
  - **FIFO** — oldest lots first. Maximises LT-qualified shares when stock was purchased long ago.
  - **Same tranche** — lots from the same grant year/type sold first (chains into LIFO for any remainder). Matches each payoff sale to its originating grant.
  - **Note:** The IRS may require a consistent lot selection method election at time of sale. Consult a tax advisor before changing this.
- **Payoff sale share counts are stored, not recomputed.** When a payoff sale is auto-generated, the share count is computed via gross-up and stored. It does not automatically update if you later change lot selection. Hit "Regen payoff sales" on the Loans page to refresh all future payoff sales at once.
- **Down payment via stock exchange is non-taxable.** The `dp_shares` field on a grant records vested shares exchanged at exercise. They reduce the loan principal and generate no income or capital gains event. Shares are consumed in lowest-cost-basis order: Bonus (RSU) lots first, then oldest Purchase lots (FIFO). This minimises the opportunity cost of the exchange by preserving higher-basis lots for future sales.
- **Cost basis for purchase grants is the purchase price, not FMV at vest.** For grants with a purchase price (`grant_price > 0`), vesting only lifts the sale restriction — it does not create a new tax event or step up the cost basis. Capital gains are computed as `sale price − purchase price`. For income/RSU grants (`grant_price = 0`), FMV at vesting is recognised as ordinary income and becomes the cost basis.
- **83(b) election is display-only.** The `election_83b` flag on a bonus grant does not change how core.py computes the timeline — `income` is still populated with `FMV × shares` at each vesting event and is used as the unrealized gain amount. The flag tells the Events page to render that value as violet `~$X` (unrealized cap gain) instead of green income, and to show potential LT cap gains tax instead of ordinary income tax. Cost basis for eventual sale remains $0 (the 83(b) price). For grants where the 83(b) was filed at a non-zero FMV, set the Cost Basis field to that price instead; core.py will treat it as a purchase grant automatically.
