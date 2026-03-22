# Roadmap: Privacy, Encryption, Admin & Beyond

## Context

Epic Stocks tracks sensitive financial data (equity grants, stock prices, loan amounts, capital gains). As an open-source, self-hosted tool, users need to trust the operator. This plan addresses data privacy, a formal privacy policy, admin capabilities, and future feature work.

---

## 1. Per-User Data Encryption

### Problem

The site operator (whoever runs the server) has direct access to the SQLite database and can read any user's financial data — share counts, prices, loan amounts, grant details, and computed income/capital gains.

### Implemented: Column-Level Encryption at Rest

When `ENCRYPTION_MASTER_KEY` is set, all sensitive financial data is encrypted per-user before being written to SQLite.

**How it works:**
- Each user gets a random AES-256 key on signup, stored encrypted with the server master key
- Sensitive columns are encrypted via SQLAlchemy TypeDecorators (transparent to all routers and `core.py`)
- Encrypted values are prefixed with `$ENC$` to distinguish from legacy plaintext
- A pure ASGI middleware sets the user's decrypted key in a `contextvar` before each request

**Encrypted fields:**
- `Grant.shares`, `Grant.price`, `Grant.dp_shares`
- `Loan.amount`, `Loan.interest_rate`, `Loan.loan_number`
- `Price.price`

**What this protects against:**
- Casual database browsing (opening the `.db` file)
- Database file theft or backup leaks
- One user's data being readable if another user's key is compromised

**What this does NOT protect against:**
- Full server compromise (attacker has both DB file AND `ENCRYPTION_MASTER_KEY`)
- This is defense-in-depth, not zero-knowledge

**To enable:** Set `ENCRYPTION_MASTER_KEY` to a strong random string in your `.env` file. If not set, encryption is disabled and data is stored as plaintext (backward compatible).

### Also Implemented: Transparency

- **Privacy Policy** (`PRIVACY.md`) linked from Login page and app footer
- **`PRIVACY_URL`** env var makes the link configurable for self-hosters
- **README** documents the trust model and encryption options


### Not Practical: Client-Side Zero-Knowledge Encryption

True zero-knowledge: encrypt/decrypt in the browser using a key derived from the user's Google identity token.

**Approach:**
- Use Web Crypto API in the browser
- Derive key from the Google ID token's signature (available on every login)
- Encrypt before sending to API, decrypt after receiving
- Server never sees plaintext financial data

**Trade-offs:**
- `core.py` can't run server-side on encrypted data — event computation would need to move to the client or use a secure enclave pattern
- Breaks Excel import/export (server can't read the data to generate Excel)
- Breaks push notifications (server can't compute "next event" for notifications)
- Major architectural change; essentially a different app

**Not doing this.** It would break server-side event computation (`core.py`), Excel export, and push notifications. The implemented approach — AES-256-GCM column encryption with random per-user keys stored encrypted under a server master key — provides meaningful protection against database theft while keeping server-side computation intact.

---

## 2. Privacy Policy

### Implemented Now

A `PRIVACY.md` at the repo root, linked from:
- The Login page (visible before account creation)
- The app footer (accessible at all times)
- The README

### Policy Covers

- **What we collect:** Google profile (email, name, picture), financial data (grants, loans, prices), computed events (never stored)
- **What we don't collect:** passwords, Google credentials, analytics, tracking cookies
- **Who can see your data:** Only you through the API; the site operator has database access
- **Data isolation:** All queries filter by authenticated user ID
- **Data retention:** Data persists until you delete it or delete your account
- **Data portability:** Excel export gives you all your data
- **Open source:** Users can audit the code, self-host, or fork
- **Operator responsibilities:** Guidance for self-hosters on securing the database

---

## 3. Admin System (Implemented)

### Admin Designation

- Admin is designated via `ADMIN_EMAIL` environment variable — **semicolon-delimited** to support multiple admins (e.g. `admin@co.com; cto@co.com`)
- `is_admin` flag on the User model, set on every login by checking the user's email against `ADMIN_EMAIL`
- Changing `ADMIN_EMAIL` takes effect on the user's next login — adding/removing emails grants/revokes access
- Admin auth is enforced via `get_admin_user()` dependency in `auth.py`, which checks the `is_admin` flag

### Admin Dashboard

`/admin` route (backend + frontend), visible only when the logged-in user's email matches `ADMIN_EMAIL`.

**Metrics displayed:**
- Total registered users
- Active users (logged in within last 30 days)
- Total grants / loans / prices across all users (counts only, no financial values)
- Storage usage (database file size)
- User list: email, name, created_at, last_login, grant/loan/price counts, admin badge
- **Search** — filter users by email or name (debounced, server-side)
- **Pagination** — 10 users per page by default, sorted by last active (most recent first)

**What admin CANNOT see:**
- Any user's financial data (prices, amounts, shares, computed events)
- Only aggregate counts and user metadata

### Admin Actions

- **Delete user** — cascades to all their grants, loans, prices, push subscriptions. **Admin users cannot be deleted** (enforced server-side).
- **Block email** — enter free-text email address + optional reason to prevent login
- **Unblock email** — remove from blocklist
- **View user activity** — when they last logged in, how many records they have
- No ability to impersonate users or view their data

### Blocked Email System

- `BlockedEmail` model stores email + reason + timestamp
- Auth flow checks against blocklist before allowing login (case-insensitive)
- Blocked emails cannot create new accounts or log into existing ones
- Admin can add/remove from the blocklist via `/api/admin/blocked`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/stats` | Aggregate stats (counts, db size) |
| GET | `/api/admin/users?q=&limit=10&offset=0` | User list with metadata + record counts + is_admin flag (paginated, searchable) |
| DELETE | `/api/admin/users/{id}` | Delete user + all their data |
| GET | `/api/admin/blocked` | List blocked emails |
| POST | `/api/admin/blocked` | Block an email (email + reason) |
| DELETE | `/api/admin/blocked/{id}` | Unblock an email |
| GET | `/api/me` | Current user info + is_admin flag |

---

## 4. Email Notifications (Implemented)

### Overview

Add email notifications alongside existing push notifications, with a **strict once-per-day maximum** for any user across all notification channels.

### User Notifications (Email + Push)

- **Event reminders** — same as push: vesting, exercise, loan repayment events happening today
- **Weekly/monthly summary** — optional digest of upcoming events
- Combine email + push into ONE daily notification job. If a user has both email and push enabled, send both in the same batch. Never send more than one email per user per day.

### Admin Notifications

- **New user signup** — email + push to admin when a new account is created
- **Milestone alerts** — e.g., user count reaches 10, 50, 100; first data import
- **System health** — daily summary: active users, new signups, errors (if any)
- Admin notifications are also subject to the once-per-day rule: batch all admin events into a single daily digest

### Implementation Plan

1. Add `RESEND_API_KEY` and `EMAIL_FROM` env vars
2. Create `backend/email_sender.py` — send via Resend API
3. Add notification preferences to User model (email_notifications: bool)
4. Add Settings page toggle for email notifications
5. Extend `send_daily_notifications()` in `notifications.py` to include email
6. Add admin notification logic (new signups, milestones)
7. Add `last_notified_at` timestamp to prevent duplicates
8. Tests: email sending (mocked SMTP), notification deduplication, admin alerts

**Implementation effort:** ~2-3 days.

---

## 5. Security Hardening (Implemented)

### DDoS / Rate Limiting

- **Handled by Cloudflare** (deployed in front of Caddy). No app-level rate limiting middleware needed.
- Cloudflare handles: DDoS mitigation, IP rate limiting, bot protection
- No need for `slowapi` or Caddy rate limit rules

### Input Validation & Injection Prevention

- **SQL injection:** Already mitigated by SQLAlchemy ORM (parameterized queries). Add explicit audit.
- **XSS:** React's JSX escaping handles output. Audit for `dangerouslySetInnerHTML` usage (should be zero).
- **CSRF:** Not applicable (JWT bearer tokens, no cookies for auth).
- **File upload validation:** Validate Excel files more strictly in import (file size limit, magic bytes check, sheet structure validation before parsing).
- **Header injection:** Validate redirect URLs, sanitize user-provided strings in notifications.

### Security Testing

- Add OWASP ZAP or similar DAST scanner to CI pipeline
- Create `backend/tests/test_security.py` with explicit tests:
  - SQL injection attempts in all string parameters
  - XSS payloads in user name, grant type, loan number fields
  - Path traversal in file upload
  - JWT tampering (expired, wrong signature, malformed)
  - IDOR tests (accessing other users' resources by ID)
  - Rate limit enforcement
- Add `npm audit` and `pip-audit` to CI for dependency vulnerability scanning
- Add Content-Security-Policy headers via Caddy

### Authentication Hardening

- JWT tokens expire after 24 hours; re-auth via Google OAuth is seamless (no refresh token mechanism — acceptable for this architecture)
- Brute force protection on auth endpoints handled by Cloudflare WAF
- Audit logging: log all admin actions, failed auth attempts, data deletions (not yet implemented)

### Implementation Plan

1. ~~Rate limiting~~ — handled by Cloudflare
2. Create security test suite (IDOR, JWT tampering, injection, path traversal)
3. Add DAST scanner to GitHub Actions (OWASP ZAP — scans running app for vulns)
4. Add `npm audit` + `pip-audit` to CI for dependency vulnerability scanning
5. Add CSP headers via Caddy
6. Add audit logging table + admin view

**Implementation effort:** ~3-4 days.

---

---

## 6. Multi-Device / Concurrent Session Hardening (Implemented)

### Problem

A user logged in on two devices (or two browser tabs) at the same time can create race conditions: both read the same grant, both modify it, one saves first and the other silently overwrites it.

### Approach: Optimistic Locking + UI Sync

**Backend: version fields**
- Add a `version` integer column to `Grant`, `Loan`, and `Price` models (default 1, auto-incremented on every write)
- PUT endpoints accept an optional `If-Match: <version>` header (or `version` field in the body)
- If the submitted version doesn't match the current DB version, return `409 Conflict` with `{ "detail": "modified_elsewhere", "current_version": N }`
- Deletes also check version if provided

**Frontend: handle conflicts gracefully**
- On `409 Conflict` from any write, show a non-dismissible banner: *"This record was changed on another device. Refresh to see the latest version."*
- Refresh button reloads the data and opens the edit form pre-populated with the latest values
- Discard button closes the form without saving

**Frontend: cross-tab sync via BroadcastChannel**
- After any successful save or delete, post a message on a `BroadcastChannel('data_sync')` channel
- Other open tabs listen and trigger a reload of the affected data type (grants, loans, prices)
- Works only across tabs in the same browser — cross-device sync still relies on the user manually refreshing

**Token management**
- Multiple valid JWTs at once is fine — no single-session enforcement
- Push subscriptions already support multiple endpoints per user (one per device)
- `PRAGMA busy_timeout=10000` is already set on SQLite — handles concurrent DB writes

### Schema Changes

```sql
ALTER TABLE grants ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE loans ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE prices ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```

Added via `_migrate_schema()` in `main.py` (no migration framework needed).

### API Changes

All PUT endpoints for grants, loans, prices:
- Accept optional `version` in request body
- Return `409 Conflict` if version mismatch
- Increment version on successful write

### Tests

- Unit: PUT with stale version → 409
- Unit: PUT with correct version → 200, version incremented
- Unit: PUT without version → 200 (backward compat, no version check)
- E2E: simulate two-tab conflict, verify conflict banner appears

### Effort: ~1 day

---

## 7. Admin: Test Notification Sender (Implemented)

### Problem

There's no way to verify that push/email notifications are working for a specific user without waiting for a real event. Admins need a "send now" tool for testing and support.

### Approach

**New admin endpoint:** `POST /api/admin/test-notify`

```json
{
  "user_id": 42,
  "title": "Test notification",
  "body": "This is a test from the admin panel."
}
```

Response:
```json
{
  "push_sent": 2,
  "push_failed": 0,
  "email_sent": true
}
```

- Sends push notification to ALL active push subscriptions for the user (they may have multiple devices)
- If the user has email notifications enabled and SMTP is configured, sends an email too
- Uses the existing `send_push_to_user()` helper and email sender from `notifications.py`
- Returns count of successful/failed pushes and whether email was sent
- Stale/expired push subscriptions that return 410 Gone are automatically deleted (same behavior as daily notifications)
- Admin-only endpoint, never exposes user financial data

**Frontend (Admin page)**

Add a "Test Notification" card in the Admin UI:
- User search/selector: type to search by email or name (reuses existing admin user search)
- Title field (pre-filled: "Test from admin")
- Body field (pre-filled: "This is a test notification from the Epic Stocks admin panel.")
- Send button → shows result inline: "Sent 2 push notifications. Email: sent."
- If the user has no push subscriptions and no email, show a warning before sending

### Tests

- Backend unit: POST → sends push to all user subscriptions, returns correct counts
- Backend unit: user with no subscriptions → push_sent=0, no error
- Backend unit: non-admin → 403
- Frontend: admin sees the form, can search users, submits, sees result

### Effort: ~0.5 days

---

## 8. Stock Sales with Wisconsin Tax Calculator (Implemented)

### Overview

Allow users to record stock sales and see estimated tax liability broken down by Wisconsin rates. Sales of unvested stock are allowed with a warning. Tax rates are configurable per-user with Wisconsin defaults.

### New Model: `Sale`

```sql
CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,           -- YYYY-MM-DD
  shares INTEGER NOT NULL,
  price_per_share REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
```

No `cost_basis` stored — that's computed from the grant history at sale time.

### New Model: `TaxSettings`

```sql
CREATE TABLE tax_settings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- Federal
  federal_income_rate REAL NOT NULL DEFAULT 0.37,
  federal_lt_cg_rate REAL NOT NULL DEFAULT 0.20,
  federal_st_cg_rate REAL NOT NULL DEFAULT 0.37,
  niit_rate REAL NOT NULL DEFAULT 0.038,
  -- State (Wisconsin defaults)
  state_income_rate REAL NOT NULL DEFAULT 0.0765,
  state_lt_cg_rate REAL NOT NULL DEFAULT 0.0536,  -- 7.65% × 70% WI exclusion
  state_st_cg_rate REAL NOT NULL DEFAULT 0.0765,
  -- Holding period threshold (days)
  lt_holding_days INTEGER NOT NULL DEFAULT 365
);
```

Wisconsin notes baked into defaults:
- Wisconsin taxes capital gains as ordinary income with a **30% exclusion** for qualifying assets held > 5 years (Epic stock qualifies as Wisconsin-based business)
- Default state LT rate = 7.65% × 0.70 = **5.36%** (assumes > 5 year hold)
- Default state ST rate = 7.65% (no exclusion)
- NIIT applies to federal investment income; no WI equivalent

**Effective combined rates with defaults:**
| Type | Federal | State | NIIT | Total |
|------|---------|-------|------|-------|
| LT cap gains | 20% | 5.36% | 3.8% | **29.16%** |
| ST cap gains | 37% | 7.65% | 3.8% | **48.45%** |
| Ordinary income (unvested) | 37% | 7.65% | — | **44.65%** |

*These are marginal rates for high earners. Users should consult a tax professional.*

### Sale Event Computation (`sales_engine.py`)

A new module (does NOT modify `core.py`) wraps the core timeline:

```python
def compute_sale_events(timeline_events, sales, tax_settings):
    """
    For each sale, walk the cumulative share/basis state at the sale date
    to determine cost basis, gain/loss, and estimated tax.
    Returns list of sale event dicts to merge into the timeline.
    """
```

**Share identification method:** FIFO (first-in, first-out) — the oldest vested shares are sold first. For unvested shares, use the current grant price as basis with an "unvested" flag.

**For each sale event, compute:**
- `gross_proceeds` = shares × price_per_share
- `cost_basis` = FIFO basis of sold shares
- `gain_loss` = gross_proceeds - cost_basis
- `hold_days` = days from vesting date to sale date
- `is_long_term` = hold_days ≥ lt_holding_days
- `unvested_shares` = shares sold that were not yet vested (0 for normal sales)
- `estimated_tax` = gain × applicable rate (LT/ST) + unvested_portion × income_rate
- `net_proceeds` = gross_proceeds - estimated_tax

**Unvested stock:**
- User can record a sale of unvested stock (some plans allow this)
- UI warns: "These shares are not yet vested. Proceeds may be taxed as ordinary income."
- Unvested portion uses `federal_income_rate + state_income_rate`

### Frontend

**Sales page** (new `/sales` nav item):
- CRUD table similar to Grants/Loans/Prices
- `+ Sale` form: Date, Shares, Price per Share, Notes
- On save, show the computed tax breakdown inline
- "Unvested shares" warning banner if the sale date is before full vesting

**Tax breakdown card** (shown after adding a sale and in the sale detail view):
```
Gross proceeds:     $125,000
Cost basis (FIFO):  $ 42,500
Net gain:           $ 82,500
  Long-term (X shares): $75,000 × 29.16% = $21,870
  Short-term (Y shares): $7,500 × 48.45% = $3,634
Estimated total tax:    $25,504
Net after tax:          $99,496
```

**Tax Settings** (new section in Settings page):
- Shows current rates for Federal income, Federal LT CG, Federal ST CG, NIIT, State income, State LT CG, State ST CG, Holding period threshold
- "Reset to Wisconsin defaults" button
- Edit form with explanatory labels

### Backend Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sales` | List user's sales |
| POST | `/api/sales` | Create a sale |
| PUT | `/api/sales/{id}` | Update a sale |
| DELETE | `/api/sales/{id}` | Delete a sale |
| GET | `/api/sales/{id}/tax` | Compute tax breakdown for a sale |
| GET | `/api/tax-settings` | Get user's tax settings |
| PUT | `/api/tax-settings` | Update tax settings |

The `/api/sales/{id}/tax` endpoint re-runs the full timeline computation to get the cumulative state at the sale date, then applies FIFO cost basis allocation and tax rates.

### Schema Migration

Add to `_migrate_schema()` in `main.py`:
- Create `sales` table if not exists
- Create `tax_settings` table if not exists

### Tests

- Unit: FIFO basis allocation for various grant combinations
- Unit: LT vs ST classification based on hold period
- Unit: unvested shares detection and income tax classification
- Unit: Wisconsin rate defaults
- Unit: CRUD endpoints (auth, user isolation)
- E2E: add a sale, verify tax breakdown visible

### Encryption

`Sale.price_per_share` and `TaxSettings` rate fields are financial data → encrypt if `ENCRYPTION_MASTER_KEY` is set.

### Effort: ~2-3 days

---

## Implementation Order

1. ✅ Privacy policy + transparency
2. ✅ Per-user column-level encryption (AES-256-GCM)
3. ✅ Admin system — dashboard, user management, email blocking
4. ✅ Admin test notification sender (section 7)
5. ✅ Multi-device / concurrent session hardening (section 6)
6. ✅ Stock sales + Wisconsin tax calculator (section 8)
7. ✅ Email notifications via Resend API (section 4)
8. ✅ Security hardening — app-level (section 5): headers, file validation, error sanitization, test suite, dependency auditing in CI
9. ✅ Security hardening — infrastructure: Cloudflare + VPS firewall locked to CF IPs

## Remaining / Future Work

| Item | Notes |
|------|-------|
| **SSH: disable password auth** | Two lines in `sshd_config` + reload. See SECURITY_HARDENING.md §3. |
| **Audit logging** | Log admin actions, failed auth attempts, data deletions to a DB table. Show in admin dashboard. |
| **DAST scanner in CI** | Add OWASP ZAP to GitHub Actions — scans the running app for vulnerabilities on every PR. |
| **Migration script** | Convert existing plaintext databases when enabling `ENCRYPTION_MASTER_KEY` for the first time. |
| **PDF loan statement import** | OCR or structured template for importing loan data directly from Epic's PDF statements. Stretch goal. |

**Decided against:**
- JWT refresh tokens — 24hr access tokens + seamless Google re-auth is sufficient for this use case
- Client-side (zero-knowledge) encryption — would break server-side event computation, Excel export, and push notifications. Not practical for this architecture.
