# Equity Vesting Tracker

A multi-user PWA for tracking equity compensation: grants, vesting schedules, stock loans, share price history, and derived event timelines showing income vs capital gains over time.

## Screenshots

### Import Flow

| Upload | Confirm | Success |
|--------|---------|---------|
| ![Import Page](screenshots/01-import-page.png) | ![Import Confirm](screenshots/02-import-confirm.png) | ![Import Success](screenshots/03-import-success.png) |

### Dashboard

| Light | Dark |
|-------|------|
| ![Dashboard Light](screenshots/dashboard-light-mobile.png) | ![Dashboard Dark](screenshots/dashboard-dark-mobile.png) |

### Export

![Export](screenshots/05-export-ready.png)

### Admin Dashboard

![Admin](screenshots/admin-light-mobile.png)

## Features

- **Event Timeline** — computed on the fly from grants, prices, and loans. Never stored. Shows income, capital gains, share price, and cumulative totals.
- **Dashboard** — summary cards (share price, total shares, income, cap gains, loan principal, next event) + 4 interactive charts.
- **CRUD Management** — full create/read/update/delete for Grants, Loans, and Prices.
- **Quick Flows** — convenience endpoints: "New Purchase" (grant + loan), "Annual Price", "Add Bonus".
- **Excel Import/Export** — bootstrap from an existing Vesting.xlsx or export current state.
- **Google Sign-In** — OAuth 2.0 authentication, automatic account creation.
- **Admin Dashboard** — user management, aggregate stats, email blocking. Admin cannot see financial data.
- **Push & Email Notifications** — daily reminders for vesting/exercise/loan events. Per-user opt-in.
- **Per-User Encryption** — AES-256-GCM column-level encryption when `ENCRYPTION_MASTER_KEY` is set.
- **Dark/Light Mode** — auto-detects system preference, updates live.
- **Mobile-First** — designed for 375px phone viewports.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12, FastAPI, SQLAlchemy, SQLite (WAL mode) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Recharts |
| Auth | Google Sign-In (OAuth 2.0) → backend JWT session tokens |
| Deploy | Docker Compose + Caddy (auto-HTTPS) |
| Tests | pytest (backend), Vitest + RTL (frontend), Playwright (E2E) |

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Google OAuth Client ID ([create one here](https://console.cloud.google.com/apis/credentials))

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The backend creates `data/vesting.db` automatically on first run.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server proxies `/api` requests to `localhost:8000`.

### Environment Variables

Create a `.env` file in the repo root (or export these):

```bash
# Required
JWT_SECRET=your-secret-key-here
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com

# Optional — encryption (encrypts financial data per-user in SQLite)
ENCRYPTION_MASTER_KEY=your-random-master-key-here

# Optional — privacy policy link shown on login page and footer
PRIVACY_URL=https://github.com/youruser/epic-stocks/blob/main/PRIVACY.md

# Optional — push notifications
VAPID_PRIVATE_KEY=...
VAPID_PUBLIC_KEY=...

# Optional — admin access (semicolon-delimited for multiple admins)
ADMIN_EMAIL=admin@example.com; cto@example.com

# Optional — email notifications (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=noreply@example.com
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

## Development

### Running Tests

```bash
# Backend (from repo root)
pytest backend/tests/ -v

# Frontend (from frontend/)
cd frontend && npm test

# All tests
pytest backend/tests/ -v && cd frontend && npm test
```

### Regenerating Screenshots

```bash
./screenshots/run.sh
```

This starts a temporary backend + frontend, seeds sample data, and captures all screenshots with Playwright.

### Project Structure

```
epic-stocks/
├── backend/
│   ├── main.py              # FastAPI app + schema migration
│   ├── core.py              # Event generation logic (frozen)
│   ├── models.py            # SQLAlchemy models (User, Grant, Loan, Price, etc.)
│   ├── database.py          # SQLite setup (WAL mode)
│   ├── auth.py              # JWT + Google OAuth + admin checks
│   ├── crypto.py            # Per-user AES-256-GCM encryption
│   ├── excel_io.py          # Excel read/write (openpyxl)
│   ├── schemas.py           # Pydantic schemas
│   ├── notifications.py     # Push + email notification logic
│   ├── routers/
│   │   ├── auth_router.py   # Google login, JWT issuance
│   │   ├── grants.py        # Grant CRUD + bulk
│   │   ├── loans.py         # Loan CRUD + bulk
│   │   ├── prices.py        # Price CRUD
│   │   ├── events.py        # Computed timeline + dashboard
│   │   ├── flows.py         # Quick flows (new purchase, bonus, price)
│   │   ├── import_export.py # Excel import/export + template
│   │   ├── push.py          # Push notification subscriptions
│   │   ├── notifications.py # Email notification preferences
│   │   └── admin.py         # Admin dashboard, user mgmt, blocklist
│   └── tests/               # pytest tests
├── frontend/
│   ├── src/
│   │   ├── pages/           # Login, Dashboard, Events, Grants, Loans, Prices, etc.
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

All endpoints require `Authorization: Bearer <jwt>` except auth, health, config, and import template.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/google` | Exchange Google ID token for JWT |
| GET | `/api/me` | Current user info + is_admin flag |
| POST | `/api/me/reset` | Reset all financial data (keeps account) |
| DELETE | `/api/me` | Delete account and all associated data |
| GET | `/api/config` | Client config (Google client ID, VAPID key, etc.) |
| GET | `/api/health` | Health check |
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
| POST | `/api/flows/new-purchase` | Create grant + optional loan |
| POST | `/api/flows/annual-price` | Add a price entry |
| POST | `/api/flows/add-bonus` | Add a bonus grant |
| POST | `/api/import/excel` | Upload Excel file to populate tables |
| GET | `/api/import/template` | Download empty Excel template |
| GET | `/api/export/excel` | Download Vesting.xlsx with all data |
| POST/DELETE | `/api/push/subscribe` | Subscribe/unsubscribe push notifications |
| GET | `/api/push/status` | Check push subscription status |
| GET/PUT | `/api/notifications/email` | Get/set email notification preference |
| GET | `/api/admin/stats` | Aggregate stats (admin only) |
| GET | `/api/admin/users?q=&limit=10&offset=0` | User list with metadata, searchable + paginated (admin only) |
| DELETE | `/api/admin/users/{id}` | Delete user + all data (admin only) |
| GET/POST | `/api/admin/blocked` | List/block emails (admin only) |
| DELETE | `/api/admin/blocked/{id}` | Unblock email (admin only) |

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
- Per-user metadata: email, name, created_at, last_login, record counts, admin badge
- Searchable user list (filter by email or name) with pagination, sorted by last active

### What Admins Cannot See

- Any user's financial data (share counts, prices, loan amounts, computed events)
- Only aggregate counts and user metadata are exposed

### Admin Actions

| Action | Description |
|--------|-------------|
| **Delete user** | Permanently removes user and all their data (grants, loans, prices, subscriptions). Admin users cannot be deleted. |
| **Block email** | Prevents an email address from logging in or creating an account. Includes optional reason field. |
| **Unblock email** | Removes an email from the blocklist, restoring login access. |
| **View user activity** | See when each user last logged in and how many records they have. |

### Blocked Email System

Blocked emails are checked at login time (case-insensitive). A blocked user cannot log in or create a new account. The blocklist is managed via the admin panel or the `/api/admin/blocked` endpoints.

## Privacy & Data Security

This application stores sensitive financial data. Please read **[PRIVACY.md](PRIVACY.md)** before deploying for others.

Key points:
- **Data isolation** — every API query filters by authenticated user ID. Users cannot see each other's data.
- **Encryption at rest** — set `ENCRYPTION_MASTER_KEY` to encrypt all financial data (shares, prices, loan amounts) per-user with AES-256-GCM. Each user gets a unique key. See [PLAN.md](PLAN.md) for details.
- **Open source** — users can audit the code, self-host their own instance, or fork the project.
- **Data portability** — users can export all their data to Excel at any time.

If you run an instance for others: secure the database file, use HTTPS, set `ENCRYPTION_MASTER_KEY`, and keep your secrets safe.

## Key Design Decisions

- **Events are never stored.** They're computed per-request from the three source tables (Grants, Loans, Prices). This eliminates sync issues entirely.
- **core.py is frozen.** The event generation logic is tested against known-good values (89 events, cum_shares=269,843, cum_income=$144,325, cum_cap_gains=$1,243,695). Don't modify it.
- **Excel import is destructive.** It replaces all existing data for that user. The import flow validates first, previews second, writes third — all in one transaction.
