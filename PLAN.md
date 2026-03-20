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

## 3. Admin System (Future)

### Admin Designation

- One user is marked as admin via an environment variable: `ADMIN_EMAIL=admin@example.com`
- On login, if the user's email matches `ADMIN_EMAIL`, set an `is_admin` flag on their user record
- Admin status is checked via a dependency, similar to `get_current_user()`

### Admin Dashboard

A new `/admin` route (backend + frontend) visible only to the admin user.

**Metrics displayed:**
- Total registered users
- Active users (logged in within last 30 days)
- Total grants / loans / prices across all users (counts only, no financial values)
- Storage usage (database file size)
- User list: email, created_at, last_login, grant/loan/price counts

**What admin CANNOT see:**
- Any user's financial data (prices, amounts, shares, computed events)
- Only aggregate counts and user metadata

### Admin Actions

- **Delete user** — cascades to all their grants, loans, prices
- **View user activity** — when they last logged in, how many records they have
- No ability to impersonate users or view their data

### Implementation Plan

1. Add `is_admin` boolean to User model + `last_login` timestamp
2. Add `ADMIN_EMAIL` env var check in auth flow
3. Create `backend/routers/admin.py` with admin-only endpoints
4. Create `frontend/src/pages/Admin.tsx` dashboard page
5. Gate the admin route behind `is_admin` check
6. Add tests for admin endpoints (authorization, data visibility)

**Implementation effort:** ~1-2 days.

---

## Implementation Order

1. **Done:** Privacy policy + transparency
2. **Done:** Per-user column-level encryption (AES-256-GCM)
3. **Next:** Admin system (section 3)
4. **Later:** Migration script for existing plaintext databases
5. **Later:** Client-side encryption (Option C), if architecture supports it
