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

## Core Concepts

Understanding a few things makes the rest of the app click.

### The data model

There are four source tables. Everything else — every dashboard number, every event on the timeline, every tax estimate — is derived from these at request time:

| Table | What it holds |
|-------|--------------|
| **Grants** | Your equity grants: year, type (Bonus/Purchase), share count, purchase price, vesting schedule, exercise date |
| **Prices** | Share price history: a date and a price per share. Each entry applies forward until the next one |
| **Loans** | Margin-style loans tied to specific grants: amount, interest rate, due date |
| **Sales** | Recorded or planned share sales: date, shares, price per share, lot selection method |

### Events are computed, not stored

The app never saves vesting events, payoff events, or projected liquidation events to the database. Every time you view the dashboard or events page, the backend runs the same deterministic calculation over your grants + prices + loans. This means the timeline is always consistent with your current data — there is no "stale event" problem, and deleting a price or changing a grant date immediately recalculates everything.

### Two prices are always in play

The *grant price* (what you paid) is fixed at grant creation. The *share price* (market value) comes from the Prices table. The spread between them drives tax calculations:

- **Bonus / RSU grants** (`grant_price = 0`) — ordinary income is recognised at each vesting date: `FMV × shares vested`. The FMV at vest becomes the cost basis for future capital gains.
- **Purchase grants** (`grant_price > 0`) — vesting lifts the sale restriction but creates no income event. Cost basis is the purchase price. Capital gains at sale = `(sale price − grant price) × shares`.
- **Long-term vs short-term** — a lot is long-term if it has been held ≥ 365 days (configurable in Settings → Tax Rates) from the vest date. LT gains are taxed at a lower rate than ST gains.

---

## Getting Started (User Guide)

1. **Sign in** — click the sign-in button for your organisation's identity provider (Google, Azure AD, or any OIDC provider configured by your admin). Your data is tied to that account, and you can export everything anytime.
2. **Add a price** — go to **Prices** and enter the current share price (Epic announces this each March). Without at least one price, no events will be computed. Use **+ Estimate** to project future prices as an annual % growth rate — useful for modeling expected increases before they're announced. Estimates appear in italics with an "est." badge and are auto-removed when Epic adds the real price for that date.
3. **Add your data** — two options:
   - **On Epic's campus network?** If you see the **"On Epic's network? Start here →"** button on the Import page, click it to download a pre-filled Excel template from Epic's campus portal — your grant and loan structure are already filled in. Download it, review the numbers, then upload it on the Import page. In Epic Mode your historical data is read-only (maintained by Epic's systems), but you can still add future price estimates, record sales, and configure tax settings.
   - **Import from Excel** — go to **Import**, download the **Sample** (pre-filled with fake data and explanatory cell comments) to see what the format looks like, then fill in your real data and upload. Click "What do the columns mean?" for a plain-English guide to every field.
   - **Add manually** — go to **Grants** and add grants one by one. Then add any **Loans** and their annual interest. For bonus/free grants where you filed an **83(b) election**, tick the "Filed 83(b) election" checkbox — vesting events will show unrealized cap gains instead of ordinary income.
4. **View the Dashboard** — summary cards (share price, total shares, income, cap gains, loan principal, interest, tax paid, cash received, next event). Use the **As of** date picker to time-travel. **Today** snaps to the current date; **Last event** jumps to your final vesting date; **Exit date** appears when you've configured one (see Settings → Exit Planning) and jumps to your projected liquidation date — showing 0 shares, 0 principal, and net cash.
5. **View Events** — the full computed timeline of vesting, exercise, loan payoff, and sale events. A **Liquidation (projected)** event is automatically appended at your exit date. Tap it to see the calculation breakdown (shares × price → gross proceeds → est. tax → net). Events after the exit date are dimmed with a "beyond exit horizon" separator.
6. **Configure your exit date** — go to **Settings → Exit Planning** to set a specific date. The projected liquidation uses shares and price as of that date (even if it's before your last vesting event). Defaults to your last vesting date if not set.
7. **Plan or record a sale** — go to **Sales** and tap **+ Sale**. See [Sales Workflow](#sales-workflow) for the full explanation of lot selection methods, the $ Target vs # Shares toggle, the tranche allocation table, and how to record actual tax paid for a past sale.
8. **Manage loan payoffs** — each loan can have an auto-generated sale that covers the outstanding balance. See [Loan Payoff Flow](#loan-payoff-flow) for how share counts are calculated and how the Request Payoff button works in Epic Mode.
9. **Set up notifications** — go to **Settings → Notifications**. Enable push (browser) or email, then choose timing: day-of, 3 days before, or 1 week before your events. Hit **Send test** to confirm push is working.
10. **Export your data** — go to **Import/Export → Download Vesting.xlsx** to get a full export at any time.

---

## Sales Workflow

| Light | Dark |
|-------|------|
| ![Sales Light Mobile](screenshots/sales-light-mobile.png) | ![Sales Dark Mobile](screenshots/sales-dark-mobile.png) |

### Plan Sale vs Record Sale

The sale form switches its title and available fields based on the date you select:

- **Plan Sale** — the date is today or in the future. Shares and tax are forward-looking estimates based on the current price and projected lots. There is no "actual tax paid" field — you haven't sold yet. In Epic Mode, only future dates are allowed.
- **Record Sale** — the date is in the past (non-Epic mode only). You're recording something that already happened. An optional **Actual tax paid** field appears so you can enter what you actually remitted — this overrides the estimate and makes the tax breakdown accurate for historical records.

### $ Target vs # Shares

Two ways to size a sale, selectable by the toggle at the top of the form:

- **$ Target** — enter the net cash you want to receive *after tax*. The app gross-ups the share count iteratively until `after-tax proceeds ≥ target`. Useful when you need a specific dollar amount (e.g. to cover a tax bill or loan balance).
- **# Shares** — enter shares directly. Gross proceeds, estimated tax, and net proceeds are shown as you type.

Both modes are available for Plan and Record sales, in Epic Mode and non-Epic Mode.

### Lot Selection Methods

When you sell shares, the app needs to know which lots are consumed first. This matters for tax — lots held longer may qualify for lower long-term capital gains rates.

| Method | Behavior | Best for |
|--------|----------|---------|
| **Epic LIFO** (default) | LIFO order within short-term lots, but all long-term lots are consumed before any short-term lot | Minimising short-term capital gains tax |
| **LIFO** | Newest vested lots first (typically highest cost basis on rising stock) | Minimising total capital gains on rising stock |
| **FIFO** | Oldest lots first | Maximising the proportion of LT-qualified shares |
| **Manual** | You set the share count for each lot individually | Full control — pick exactly which lots to sell |

Your default method is set in **Settings → Tax Rates → Manual Sale Lot Method** and applies to manually-initiated sales only. Loan payoff sales always use same-tranche selection (see [Loan Payoff Flow](#loan-payoff-flow)).

> **Tax note:** The IRS may require you to elect a consistent lot identification method at the time of sale. Consult a tax advisor before changing this setting, especially for large or tax-sensitive sales.

### Tranche Allocation Table

As soon as you enter a date and a share count (or $ target), a **Lot Allocation** table appears below the form. It updates in real time and shows:

- Each available lot (grant year + type, vest date)
- Cost basis per share for that lot
- Available shares remaining in the lot
- How many shares will be consumed from that lot (allocated)
- **LT** (long-term, held ≥ your configured threshold) or **ST** (short-term) badge — LT lots appear green, ST lots amber

In **Manual** mode, the "Allocated" column becomes an editable number input. Type the share count you want to sell from each lot. The form prevents over-allocation and tracks total allocated shares vs. what you requested. Your manual allocation is saved with the sale.

### Tax Breakdown

After saving a sale, tap the tax amount in the sales list to expand a full breakdown:

- Gross proceeds = shares × price
- Ordinary income component (for Bonus/RSU lots where FMV at vest was recognised as income)
- Short-term and long-term capital gains per lot
- Federal income tax, federal LT/ST capital gains tax, NIIT (3.8%), state income tax, state capital gains tax
- **Estimated total tax** and **Net proceeds**

Tax rates are captured from your Settings at the time the sale is created and stored on the sale record. Changing your tax rates later does not retroactively change a saved sale's breakdown.

---

## Loan Payoff Flow

Each loan tied to a Purchase grant can have an auto-generated payoff sale that covers the outstanding balance (principal + accrued interest through the due date) by selling just enough shares.

### How the gross-up works

The app finds the smallest integer share count such that the after-tax proceeds from selling those shares ≥ the outstanding balance (cash due). It only considers lots from the *originating grant* — this is called same-tranche selection and applies regardless of your default lot method setting.

The payoff sale always shows a **Lot Allocation** table in the Request Payoff modal (Epic Mode) or in the sale record on the Sales page, so you can see exactly which lots from that grant are being consumed and whether they are LT or ST.

### Auto-generated payoff sales

When you create a loan with **Payoff loan via sale** checked (the default), a payoff sale is created automatically:

- **Date** — the loan's due date
- **Shares** — gross-up calculation at the price on or just before the due date
- **Price** — share price at the due date
- **Lot selection** — same-tranche (originating grant's lots only)
- **Tax rates** — your current Settings at creation time, locked to the sale record

If you later change tax rate settings or add new share prices, the stored share count will be stale. Use **Regen payoff sales** on the Loans page to recompute share counts for all future payoff sales at once (this also updates the locked tax rates to your current settings).

### Request Payoff (Epic Mode)

In Epic Mode, each loan row shows a **Request Payoff** button instead of an Edit button. This opens a modal that shows the full payoff picture before you commit:

1. **Outstanding balance** — principal + projected interest to the due date
2. **Shares to sell** — gross-up result (after-tax proceeds ≥ balance)
3. **Price per share** — share price at the due date
4. **Est. gross proceeds** — shares × price
5. **Sale date** — the loan due date
6. **Lot Allocation table** — shows which lots from the originating grant are consumed, with LT/ST classification

Tap **Confirm Payoff** to create the payoff sale. It appears immediately in the Sales list and on the Events timeline as a "Loan Payoff Sale" event.

If a payoff sale for the loan already exists (e.g. auto-created at loan setup), Confirm Payoff returns the existing sale rather than creating a duplicate.

---

## Features

- **Event Timeline** — computed on the fly from grants, prices, and loans. Never stored. Shows income, capital gains, share price, and cumulative totals. A **Liquidation (projected)** event is auto-injected at the exit date: tap it to see a breakdown (shares × price → gross proceeds → est. tax → net). Events after the exit date are dimmed with a "beyond exit horizon" separator so it's clear they won't occur if you liquidate.
- **Exit Planning** — set an exit date in Settings → Exit Planning to project a full liquidation at any point, even before your last vesting event. The projection uses only the shares and price available as of that date. Dashboard quick buttons update to include an **Exit date** shortcut; card values at the exit date correctly show 0 shares, 0 loan principal, and net cash (gross proceeds − loans − tax).
- **Dashboard** — summary cards (share price, total shares, income, cap gains, loan principal, total interest, tax paid, cash received, next event) with an **As of** date picker and quick buttons: **Today**, **Last event** (final vesting date), and **Exit date** (when configured). Interactive charts include an Interest Over Time chart with guaranteed vs. projected interest-on-interest layers. Empty state shows getting-started prompts for new users.
- **Stock Sales** — plan or record share sales with configurable lot selection (Epic LIFO/FIFO/LIFO/Manual), LT/ST capital gains split, and Wisconsin tax calculator. Choose a $ target (shares auto-computed after-tax via gross-up) or enter shares directly. A live tranche table shows lot-level allocation per vest date with LT/ST classification. Manual mode makes each lot's allocation editable. For past-date sales, enter actual tax paid to override the estimate. See [Sales Workflow](#sales-workflow) for the full explanation.
- **CRUD Management** — full create/read/update/delete for Grants, Loans, Prices, and Sales.
- **Quick Flows** — convenience endpoints: "New Purchase" (grant + loan with optional stock down payment), "Annual Price", "Add Bonus".
- **83(b) Election Support** — bonus/free grants can be flagged as having an 83(b) election filed. Vesting events for these grants show unrealized cap gains (violet `~$X`) instead of ordinary income, with a tappable card explaining the cost basis and potential LT cap gains tax at eventual sale.
- **Down Payment Rules** — configurable minimum DP policy (percent of purchase and dollar cap). "Prefer stock DP" auto-calculates the minimum stock exchange down payment on new purchases. Default: 10% or $20,000, whichever is lower.
- **Excel Import/Export** — bootstrap from an existing Vesting.xlsx or export current state. The Import page includes a downloadable sample file (pre-filled with fake data, with cell comments explaining every field) and a built-in column reference guide.
- **OIDC Sign-In** — provider-agnostic PKCE flow works with any standards-compliant IdP (Google, Azure Entra ID, etc.). Multiple providers can be enabled simultaneously — the login page shows one button per provider. Automatic account creation; data is tied to the account.
- **Admin Dashboard** — user management, aggregate stats, email blocking, system health monitoring (CPU, RAM, DB size, and cache hit rate sparklines with 24h/72h/7d/30d windows), per-table DB size breakdown, and a Danger Zone for maintenance mode and Epic Mode toggles. Admin cannot see financial data.
- **Push & Email Notifications** — configurable advance timing: day-of, 3 days before, or 1 week before each event. Per-user opt-in for each channel independently. Includes a "Send test" button to confirm push is working.
- **Per-User Encryption** — AES-256-GCM column-level encryption. Two-level key hierarchy: `KEY_ENCRYPTION_KEY` (env var, set once, never changes) wraps an operational master key stored encrypted in the database. The master key can be rotated live from the admin panel — all replicas pick up the new key automatically within seconds, no restart required. Each user has a unique per-user key wrapped by the master key.
- **Growth Price Estimator** — project future share prices via annual % growth from the current price. Default start date is the next March 1 (matching Epic's typical price announcement cadence). Generates one price per year through a configurable end date. Estimates are visually distinguished (italic, "est." badge) and automatically removed when a real price is added for the same date. Available in Epic Mode — tap **+ Estimate** on the Prices page.
- **Epic Mode** — read-only deployment mode for use with Epic's managed data pipeline. When active, historical grant/price/loan/import writes are blocked (403) and the UI shows a "Historical data provided by Epic — view only" notice. Future price estimates remain writable (via **+ Price** for individual future dates, or **+ Estimate** for bulk growth projections). Each grant row shows a **Sell** button and each loan row shows a **Request Payoff** button (with lot allocation preview) so users can still act on their data. Sales are always writable but require a future date. Toggled from Admin → Danger Zone, or hard-locked via the `EPIC_MODE=true` env var. A `POST /api/internal/cache-invalidate` webhook lets Epic's batch jobs pre-warm the Redis cache after writing. Past estimates are automatically cleaned up nightly and on page load once their date has passed. See [Loan Payoff Flow](#loan-payoff-flow) for the Request Payoff modal detail.
- **Maintenance Mode** — two distinct mechanisms: (1) app-managed downtime stored in the database — all replicas see the toggle instantly; financial API routes return 503 while auth and admin remain accessible; (2) deploy-time full downtime via a Caddy sentinel file (`./data/full_maintenance`) that serves a static 503 page while the app container is stopped.
- **Dark/Light Mode** — auto-detects system preference, updates live.
- **Mobile-First** — designed for 375px phone viewports.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy, PostgreSQL (Alembic migrations) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Recharts |
| Auth | OIDC PKCE (any provider) → BFF session cookie (HttpOnly, XSS-safe) |
| Deploy | Docker Compose + Caddy (auto-HTTPS) + Cloudflare (DDoS protection) |
| Tests | pytest (backend), Vitest + RTL (frontend), Playwright (E2E) |

## Quick Start

### Prerequisites

- Python 3.12+
- Node.js 20+
- At least one OIDC provider configured in `OIDC_PROVIDERS` (see [Environment Variables](#environment-variables))

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
| `JWT_SECRET` | Yes (local dev) | Random secret for signing JWT tokens. **Auto-generated on production deploy.** |
| `OIDC_PROVIDERS` | Yes | JSON array of OIDC provider configs — see `.env.example` for format. Supports Google, Azure Entra ID, or any OIDC-compliant IdP. Multiple providers show as separate sign-in buttons. |
| `DATABASE_URL` | Yes (prod) | PostgreSQL DSN. Docker Compose sets this automatically from `POSTGRES_PASSWORD`. |
| `REDIS_URL` | No | Redis connection string for the timeline L2 cache (e.g. `redis://localhost:6379/0`). When set, computed event timelines are cached in Redis and pre-warmed in the background after data writes, allowing cache hits to survive process restarts and be shared across replicas. Omit for single-process deployments. The `redis` service in `docker-compose.yml` provides this automatically when `REDIS_URL=redis://redis:6379/0`. |
| `EPIC_MODE` | No | Set to `true` to hard-lock Epic Mode on at the env level (overrides the admin toggle). Normally leave unset and use the Admin panel toggle instead. |
| `CACHE_INVALIDATE_SECRET` | No (Epic deployments) | Bearer token secret for `POST /api/internal/cache-invalidate`. Epic's batch systems POST to this endpoint after writing data. **Auto-generated on production deploy** and stored in `.secrets/cache_invalidate_secret`. Read the generated value off the server to configure Epic's webhook caller. Endpoint returns 503 if unset. |
| `EPIC_ONBOARDING_URL` | No | URL surfaced on the login/onboarding page for Epic users who need to set up their account. |
| `POSTGRES_PASSWORD` | Yes (local dev) | Password for the `postgres` user. **Auto-generated on production deploy.** |
| `KEY_ENCRYPTION_KEY` | No | Enables per-user AES-256-GCM encryption. Set once, never changes. **Auto-generated on production deploy** and stored in `.secrets/key_encryption_key`. Wraps the operational master key stored in the database. |
| `LEGACY_MASTER_KEY` | No | One-time migration aid. Set to the old `ENCRYPTION_MASTER_KEY` value on first deploy after upgrading to the two-level key hierarchy; unset it after the first successful boot. |
| `ADMIN_EMAIL` | No | Semicolon-delimited email(s) granted admin access on login |
| `VAPID_PUBLIC_KEY` | No | Required for push notifications. **Auto-generated on production deploy.** |
| `VAPID_PRIVATE_KEY` | No | Required for push notifications. **Auto-generated on production deploy.** |
| `EMAIL_PROVIDER` | No | `resend` (default) or `smtp` |
| `RESEND_API_KEY` | No | Enables email notifications via [Resend](https://resend.com) |
| `RESEND_FROM` | No | Sender address for emails (e.g. `Equity Tracker <noreply@yourdomain.com>`) |
| `SMTP_HOST` | No | SMTP server hostname (when `EMAIL_PROVIDER=smtp`) |
| `SMTP_PORT` | No | SMTP port, default 587 |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `SMTP_FROM` | No | Sender address for SMTP emails |
| `APP_URL` | No | Public app URL included as a link in email notifications |
| `ACME_EMAIL` | No (prod) | Email address for Let's Encrypt certificate expiry notifications. Set as a GitHub Actions variable. |
| `TRUSTED_PROXY_IPS` | No (prod) | Cloudflare IP ranges passed to Caddy for real-IP forwarding. Set as a GitHub Actions variable. |
| `COMMIT_SHA` | No | Git commit SHA injected at Docker build time. Displayed as a 7-char short hash at the bottom of the Admin and Settings pages so testers can confirm which build is running. **Set automatically by the deploy workflow.** |

### OIDC_PROVIDERS format

Set `OIDC_PROVIDERS` to a JSON array of provider objects:

```bash
OIDC_PROVIDERS='[{"name":"google","label":"Google","client_id":"YOUR_ID.apps.googleusercontent.com","client_secret":"YOUR_SECRET","discovery_url":"https://accounts.google.com/.well-known/openid-configuration"}]'
```

Each object supports:
- `name` — internal identifier (e.g. `"google"`, `"azure"`)
- `label` — displayed on the sign-in button (e.g. `"Google"`, `"Contoso Azure AD"`)
- `client_id` — from your IdP's app registration
- `client_secret` — optional; omit for PKCE-only / native-app clients
- `discovery_url` — OIDC discovery endpoint (`.well-known/openid-configuration`)
- `scopes` — optional; defaults to `["openid","email","profile"]`
- `subject_claim` — optional; defaults to `"sub"`. Set to `"oid"` for Azure Entra ID

Multiple providers show as separate "Sign in with X" buttons on the login page. Redirect URI to register in your IdP: `https://yourdomain.com/auth/callback`

Example with Google and Azure Entra ID together:
```json
[
  {
    "name": "google",
    "label": "Google",
    "client_id": "YOUR_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_SECRET",
    "discovery_url": "https://accounts.google.com/.well-known/openid-configuration"
  },
  {
    "name": "azure",
    "label": "Contoso Azure AD",
    "client_id": "YOUR_AZURE_CLIENT_ID",
    "discovery_url": "https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0/.well-known/openid-configuration",
    "subject_claim": "oid"
  }
]
```

For local development, generate VAPID keys with:
```bash
npx web-push generate-vapid-keys
```

The login page fetches available sign-in providers from the backend at `GET /api/auth/providers` — no frontend env vars needed.

## Production Deployment

### Multi-App Caddy (shared infrastructure)

This app uses a shared Caddy reverse proxy. The infra compose file manages Caddy and the shared `proxy` Docker network; each app manages itself.

The deploy script handles everything automatically on first deploy — it creates the `proxy` Docker network if it doesn't exist and starts (or updates) the infra Caddy container. No manual SSH steps are needed. Each deployed app writes a `caddy/app.caddy` snippet into the shared `caddy_config` volume and reloads Caddy, all handled by the deploy workflow.

### Manual VPS Setup (per app)

```bash
# One-time setup on the VPS (per app)
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/epic-stocks/data
cd /opt/epic-stocks
git clone <repo-url> .
```

Set `OIDC_PROVIDERS`, `DOMAIN`, and other secrets as GitHub Actions variables/secrets — the deploy workflow writes `.env` automatically on every push to `main`. Never create `.env` on the VPS manually.

### Deploy Safety

The deploy workflow includes two safeguards against silent failures:

1. **Caddy snippet validation** — a `caddy-validate` CI job wraps `caddy/app.caddy` in a minimal Caddyfile and validates it before deploy, catching syntax errors before they reach prod.
2. **Post-deploy health polling** — after `docker compose up -d`, the deploy script polls `http://localhost/api/health` for up to 60 seconds. If the app doesn't respond, it prints `docker compose ps`, recent logs, recent commits, and manual rollback instructions, then exits 1. No auto-rollback — Alembic runs migrations on startup, so reverting code after a schema migration requires manual review.

**Downtime during deploy** — the deploy script touches a sentinel file in the shared `appdata` Docker volume before stopping the app container. Caddy serves a static "Down for Maintenance" page (auto-refreshes every 20 s, `Cache-Control: no-store`) until the sentinel is removed at the end of the script. This is separate from app-managed maintenance (rotation / admin toggle), which uses a different sentinel and keeps the app running.

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

The codebase is split into **scaffold** (auth, admin, crypto, notifications — reusable) and **app** (equity tracking domain logic — replaceable when forking). See [FORK_GUIDE.md](FORK_GUIDE.md) for how to fork for a different domain.

```
epic-stocks/
├── backend/
│   ├── main.py              # FastAPI app + router wiring + metrics sampler
│   ├── database.py          # SQLAlchemy engine setup
│   ├── schemas.py           # Shared Pydantic schemas
│   ├── alembic/             # Alembic migrations (run on startup)
│   ├── scaffold/            # Reusable auth/infra layer (keep when forking)
│   │   ├── auth.py          # JWT creation/verification + admin checks
│   │   ├── crypto.py        # Per-user AES-256-GCM encryption
│   │   ├── email_sender.py  # Email dispatch (delegates to providers/)
│   │   ├── epic_mode.py     # Epic Mode state (DB-backed, 1s TTL cache, env override)
│   │   ├── maintenance.py   # Sentinel path for app-managed downtime
│   │   ├── models.py        # SQLAlchemy models (User, BlockedEmail, SystemMetric, etc.)
│   │   ├── notifications.py # Push + email notification logic
│   │   ├── providers/
│   │   │   ├── auth/        # OIDC provider (generic PKCE; joserfc for JWT/JWKS verification)
│   │   │   └── email/       # Email providers: Resend, SMTP
│   │   └── routers/
│   │       ├── auth_router.py   # OIDC PKCE endpoints + JWT issuance
│   │       ├── admin.py         # Admin dashboard, user mgmt, blocklist
│   │       ├── notifications.py # Email notification preferences
│   │       └── push.py          # Push subscription management
│   ├── app/                 # Equity tracking domain (replace when forking)
│   │   ├── core.py          # Event generation logic (frozen)
│   │   ├── sales_engine.py  # FIFO cost-basis + tax + gross-up calculations
│   │   ├── excel_io.py      # Excel read/write (openpyxl)
│   │   ├── timeline_cache.py # L1 in-process memoized event computation (content-addressed)
│   │   ├── event_cache.py   # L2 Redis cache + background recompute + redis_info()
│   │   └── routers/
│   │       ├── grants.py    # Grant CRUD + bulk
│   │       ├── loans.py     # Loan CRUD + bulk
│   │       ├── prices.py    # Price CRUD
│   │       ├── events.py    # Computed timeline + dashboard
│   │       ├── horizon.py   # Exit date settings
│   │       ├── flows.py     # Quick flows (new purchase, bonus, price)
│   │       ├── import_export.py # Excel import/export + template
│   │       ├── sales.py     # Sales CRUD + tax breakdown
│   │       └── cache.py     # POST /api/internal/cache-invalidate webhook
│   └── tests/               # pytest tests
├── frontend/
│   ├── src/
│   │   ├── scaffold/        # Reusable UI layer (keep when forking)
│   │   │   ├── pages/       # Login, AuthCallback, Admin, Settings, PrivacyPolicy
│   │   │   ├── components/  # Layout shell, Toast
│   │   │   ├── contexts/    # ThemeContext, MaintenanceContext
│   │   │   └── hooks/       # useAuth, useConfig, useDark, usePush, useMe
│   │   ├── app/             # Equity tracking UI (replace when forking)
│   │   │   ├── pages/       # Dashboard, Events, Grants, Loans, Prices, Sales, ImportExport
│   │   │   └── hooks/       # useApiData, useDataSync
│   │   ├── App.tsx          # Router + layout wiring
│   │   └── __tests__/       # Vitest tests
│   ├── public/
│   │   ├── sw.js            # Service worker (cache busting + push)
│   │   └── manifest.json    # PWA manifest
│   ├── e2e/                 # Playwright specs
│   └── playwright.config.ts
├── infra/
│   ├── docker-compose.infra.yml  # Shared Caddy + proxy network (one per server)
│   └── Caddyfile                 # Root config: imports per-app snippets
├── caddy/
│   ├── Caddyfile            # Per-app Caddy config (reverse proxy + cache headers)
│   └── app.caddy            # Caddy snippet for multi-app mode
├── screenshots/             # Auto-generated by Playwright
│   ├── run.sh               # Screenshot capture orchestrator
│   └── seed.py              # Sample data seeder
├── Dockerfile               # Multi-stage build (frontend + backend)
├── docker-compose.yml       # App compose (joins shared proxy network; always uses shared proxy network)
├── FORK_GUIDE.md            # How to fork for a different domain
└── test_data/
    └── fixture.xlsx         # Synthetic test fixture
```

## API Overview

All authenticated endpoints require a valid `session` cookie (set automatically by the browser after sign-in). There is no Bearer token — the JWT lives only in an HttpOnly cookie that JavaScript cannot read. The companion `auth_hint` cookie (readable by JS) tells the SPA whether a session exists without exposing the credential.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/providers` | List configured OIDC providers (name + label) |
| GET | `/api/auth/login?provider=&code_challenge=&redirect_uri=&state=` | Start PKCE flow — returns IdP authorization URL |
| POST | `/api/auth/callback` | Exchange PKCE code for JWT |
| GET | `/api/me` | Current user info + is_admin flag |
| POST | `/api/me/reset` | Reset all financial data (keeps account) |
| DELETE | `/api/me` | Delete account and all associated data |
| GET | `/api/config` | Client config (VAPID key, email availability, etc.) |
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
| GET | `/api/sales/{id}/tax` | Tax breakdown for a sale |
| GET | `/api/sales/tax` | Bulk tax breakdown for all sales |
| GET | `/api/sales/lots` | Available share lots grouped by cost basis |
| GET | `/api/sales/tranche-allocation` | Lot-level allocation for a proposed sale (date, shares, method) |
| GET | `/api/sales/estimate` | Gross-up estimate: shares needed to net a target cash amount |
| GET | `/api/loans/{id}/payoff-sale-suggestion` | Suggested gross-up sale for a loan |
| POST | `/api/loans/regenerate-all-payoff-sales` | Recompute all future payoff sale share counts |
| GET/POST | `/api/loan-payments` | List/create early loan payments |
| PUT/DELETE | `/api/loan-payments/{id}` | Update/delete a loan payment |
| POST | `/api/flows/new-purchase` | Create grant + optional loan |
| POST | `/api/flows/annual-price` | Add a price entry (future dates flagged as estimates) |
| POST | `/api/flows/growth-price` | Generate yearly estimate prices from % annual growth |
| POST | `/api/flows/add-bonus` | Add a bonus grant |
| POST | `/api/import/excel` | Upload Excel file to populate tables |
| GET | `/api/import/template` | Download empty Excel template |
| GET | `/api/import/sample` | Download sample Excel file pre-filled with fake data and cell comments |
| GET | `/api/export/excel` | Download Vesting.xlsx with all data |
| GET/PUT | `/api/horizon-settings` | Get/set exit date for projected liquidation |
| POST | `/api/internal/cache-invalidate` | Pre-warm Redis cache (Epic batch webhook; requires `Authorization: Bearer <CACHE_INVALIDATE_SECRET>`) |
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
2. Sign in with a matching account via any configured OIDC provider
3. Navigate to `/admin` in the app

### What Admins Can See

- Total registered users and active users (last 30 days)
- Aggregate counts: total grants, loans, prices across all users
- Database storage usage
- **System Health** — current CPU %, RAM %, and DB size with sparkline charts (24h/72h/7d/30d windows). Sampled every 15 minutes; 30-day rolling retention.
- **Database Tables** — per-table size breakdown showing which tables are large (PostgreSQL only). Useful for diagnosing storage growth; includes a note explaining PostgreSQL's ~7–8 MB baseline overhead.
- Per-user metadata: email, name, created_at, last_login, record counts, admin badge
- Searchable user list (filter by email or name) with pagination, sorted by last active
- **Build version** — a 7-character commit SHA is shown in small muted text at the bottom of the Admin page (and the Settings page for all users), so testers can confirm exactly which build is running without needing server access

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
| **Rotate encryption key** | Generates a new master key, re-wraps all per-user keys, smoke-tests, then persists to the database and clears maintenance. New key propagates to all replicas automatically within seconds — no deploy or env var change needed. A snapshot of old keys is saved to the database before any changes; restored automatically on failure. |
| **Restore from snapshot** | Appears in the admin panel when an interrupted rotation left a snapshot in the database. Writes the old per-user keys back and clears maintenance — recovers from a crash without SSH access. |

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
- **BFF auth / XSS protection** — the JWT is stored in an `HttpOnly; Secure; SameSite=Lax` session cookie, not in `localStorage` or a JavaScript variable. JavaScript cannot read it, so a successful XSS attack cannot exfiltrate the credential and replay it from an attacker's origin. A companion `auth_hint` cookie (not HttpOnly) lets the SPA know a session exists without exposing the token itself.
- **Data isolation** — every API query filters by authenticated user ID. Users cannot see each other's data.
- **Encryption at rest** — financial data (shares, prices, loan amounts) is encrypted per-user with AES-256-GCM. Two-level hierarchy: `KEY_ENCRYPTION_KEY` (env var, set once) wraps an operational master key stored encrypted in the `system_settings` DB table. Each user gets a unique key wrapped by the master key. Rotating the master key re-wraps only the per-user key wrappers — not all data — and propagates to all replicas automatically.
- **Open source** — users can audit the code, self-host their own instance, or fork the project.
- **Data portability** — users can export all their data to Excel at any time.

If you run an instance for others: secure the database, use HTTPS, set `KEY_ENCRYPTION_KEY`, and keep your secrets safe. See **[OPERATIONS.md](OPERATIONS.md)** for a full checklist of what the app does automatically vs. what you need to configure in your hosting environment (Cloudflare, SSH hardening, VPS firewall, backups, runbook).

## Key Design Decisions

- **Events are never stored.** They're computed per-request from the three source tables (Grants, Loans, Prices). This eliminates sync issues entirely.
- **core.py is frozen.** The event generation logic is tested against known-good values (89 events, cum_shares=558,500, cum_income=$144,325, cum_cap_gains=$1,224,195). Don't modify it.
- **Excel import is per-sheet, not all-or-nothing.** Only the sheets present in the uploaded file are replaced (Schedule → grants, Loans → loans + payoff sales, Prices → prices). Sheets not included in the file are left untouched. The import flow validates first, previews second, writes third — all in one transaction. A backup snapshot of the affected data is saved automatically before each import (last 3 kept per user). Restore via `GET /api/import/backups` + `POST /api/import/backups/{id}/restore`.
- **Lot selection method is user-configurable (default: Epic LIFO).** See [Sales Workflow → Lot Selection Methods](#lot-selection-methods) for the full comparison table. In short: Epic LIFO minimises STCG; LIFO minimises total gains on rising stock; FIFO maximises LT-qualified shares; Manual gives full control via the tranche table. Loan payoff sales always use same-tranche regardless of this setting. The IRS may require a consistent election at time of sale — consult a tax advisor before changing.
- **Payoff sale share counts are stored, not recomputed.** When a payoff sale is auto-generated, the share count is computed via gross-up and stored. It does not automatically update if you later change lot selection. Hit "Regen payoff sales" on the Loans page to refresh all future payoff sales at once.
- **Down payment via stock exchange is non-taxable.** The `dp_shares` field on a grant records vested shares exchanged at exercise. They reduce the loan principal and generate no income or capital gains event. Shares are consumed in lowest-cost-basis order: Bonus (RSU) lots first, then oldest Purchase lots (FIFO). This minimises the opportunity cost of the exchange by preserving higher-basis lots for future sales.
- **Cost basis for purchase grants is the purchase price, not FMV at vest.** For grants with a purchase price (`grant_price > 0`), vesting only lifts the sale restriction — it does not create a new tax event or step up the cost basis. Capital gains are computed as `sale price − purchase price`. For income/RSU grants (`grant_price = 0`), FMV at vesting is recognised as ordinary income and becomes the cost basis.
- **83(b) election is display-only.** The `election_83b` flag on a bonus grant does not change how core.py computes the timeline — `income` is still populated with `FMV × shares` at each vesting event and is used as the unrealized gain amount. The flag tells the Events page to render that value as violet `~$X` (unrealized cap gain) instead of green income, and to show potential LT cap gains tax instead of ordinary income tax. Cost basis for eventual sale remains $0 (the 83(b) price). For grants where the 83(b) was filed at a non-zero FMV, set the Cost Basis field to that price instead; core.py will treat it as a purchase grant automatically.
