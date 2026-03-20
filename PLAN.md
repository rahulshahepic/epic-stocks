# Roadmap: Privacy, Encryption & Admin

## Context

Epic Stocks tracks sensitive financial data (equity grants, stock prices, loan amounts, capital gains). As an open-source, self-hosted tool, users need to trust the operator. This plan addresses three areas: data privacy, a formal privacy policy, and admin capabilities.

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

### Option C — Client-Side Encryption (Future, Complex)

Encrypt sensitive financial fields before writing to SQLite, decrypt on read.

**Approach:**
- Derive a per-user encryption key from their Google OAuth token using HKDF (HMAC-based Key Derivation Function)
- Use the Google `sub` (subject ID) as a stable salt — it never changes for a given Google account
- Encrypt sensitive fields: `Grant.price`, `Grant.shares`, `Loan.amount`, `Loan.interest_rate`, `Price.price`
- Use AES-256-GCM (authenticated encryption) via Python's `cryptography` library
- Store encrypted values as base64-encoded strings in the database
- Decrypt in the API layer before returning data or passing to `core.py`

**Key derivation:**
```
user_key = HKDF(
    algorithm=SHA256,
    length=32,
    salt=google_sub.encode(),
    info=b"epic-stocks-user-encryption",
    ikm=server_master_key.encode()   # from JWT_SECRET or separate env var
)
```

**Trade-offs:**
- The operator still holds the master key (it's a server env var), so this is defense-in-depth, not zero-knowledge
- Encrypted fields can't be queried/indexed by the DB (but we only ever filter by `user_id`, never by financial values)
- If the master key is lost, all encrypted data is unrecoverable
- Adds complexity to import/export flows

**Implementation effort:** ~2-3 days. Requires a migration to convert existing plaintext data.

### Option C — Client-Side Encryption (Future, Complex)

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

**Recommendation:** Option C is not practical for this architecture. Option B provides meaningful protection against casual database inspection while keeping server-side computation intact.

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
- User list: email, name, created_at, last_login, grant/loan/price counts

**What admin CANNOT see:**
- Any user's financial data (prices, amounts, shares, computed events)
- Only aggregate counts and user metadata

### Admin Actions

- **Delete user** — cascades to all their grants, loans, prices, push subscriptions
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
| GET | `/api/admin/users` | User list with metadata + record counts |
| DELETE | `/api/admin/users/{id}` | Delete user + all their data |
| GET | `/api/admin/blocked` | List blocked emails |
| POST | `/api/admin/blocked` | Block an email (email + reason) |
| DELETE | `/api/admin/blocked/{id}` | Unblock an email |
| GET | `/api/me` | Current user info + is_admin flag |

---

## 4. Email Notifications (Future)

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

1. Add `SMTP_*` env vars (host, port, user, password, from_address)
2. Create `backend/email.py` — send via SMTP (or use a service like SendGrid/SES)
3. Add notification preferences to User model (email_notifications: bool)
4. Add Settings page toggle for email notifications
5. Extend `send_daily_notifications()` in `notifications.py` to include email
6. Add admin notification logic (new signups, milestones)
7. Add `last_notified_at` timestamp to prevent duplicates
8. Tests: email sending (mocked SMTP), notification deduplication, admin alerts

**Implementation effort:** ~2-3 days.

---

## 5. Security Hardening (Future)

### DDoS / Rate Limiting

- Add rate limiting middleware (e.g., `slowapi` or custom token bucket)
- Rate limits per endpoint:
  - Auth endpoints: 5 requests/minute per IP
  - API endpoints: 60 requests/minute per user
  - Admin endpoints: 30 requests/minute per user
- Add `X-RateLimit-*` response headers
- Configure Caddy for connection rate limiting at the reverse proxy level
- Add fail2ban rules for repeated 401/403 responses

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

- JWT token rotation (refresh tokens)
- Session invalidation on password change / account deletion
- Brute force protection on auth endpoints
- Audit logging: log all admin actions, failed auth attempts, data deletions

### Implementation Plan

1. Add `slowapi` rate limiting to FastAPI
2. Configure Caddy rate limits
3. Create security test suite
4. Add DAST scanner to GitHub Actions
5. Add dependency audit to CI
6. Add CSP headers
7. Add audit logging table + admin view

**Implementation effort:** ~3-4 days.

---

## Implementation Order

1. **Done:** Privacy policy + transparency
2. **Done:** Per-user column-level encryption (AES-256-GCM)
3. **Done:** Admin system (section 3) — admin dashboard, user management, email blocking
4. **Next:** Email notifications (section 4)
5. **Next:** Security hardening (section 5)
6. **Later:** Migration script for existing plaintext databases
7. **Later:** Client-side encryption, if architecture supports it
