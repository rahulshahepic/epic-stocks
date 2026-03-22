# Security Hardening Plan

Three areas in priority order. Sections 1 and 3 are infrastructure tasks requiring server/DNS access; Section 2 is implemented in this repo.

---

## 1. Cloudflare (DDoS / bot protection) — ✅ Done

> **Status: Complete — Cloudflare is live, all web traffic required to go through it**

### Completed

1. ✅ Site added to Cloudflare, nameservers updated at registrar
2. ✅ SSL/TLS mode set to **Full (Strict)**
3. ✅ WAF rate-limiting rules active:
   - Block IPs hitting `/api/auth/*` more than **10 req/min**
   - Block IPs hitting `/api/*` more than **200 req/min**
4. ✅ VPS firewall locked to allow ports 80/443 **only from Cloudflare IP ranges** — origin IP not directly reachable
5. Caddy receives real client IPs via `CF-Connecting-IP` header (no extra config needed)

**No Python-level rate limiting (slowapi) — Cloudflare handles this at the edge.**

---

## 2. Application-Level Security — Implemented in This Repo

### 2a. Security Headers (Caddyfile) ✅

Added to all routes:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://accounts.google.com; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` |

### 2b. File Upload Hardening (import_export.py) ✅

- Reject files larger than **5 MB** before parsing
- Validate **XLSX magic bytes** (`PK\x03\x04` — ZIP format) before passing to openpyxl
- Prevents: oversized file DoS, malformed/malicious file parsing

### 2c. Hybrid 500 Error Sanitization ✅

- Unhandled exceptions are logged to the `error_logs` DB table (timestamp, path, method, error type, message, traceback, user ID)
- **Non-admin users** receive a generic `"Internal server error"` response
- **Admin users** receive the full error detail in the response (identified by valid admin JWT)
- Admin dashboard has an **Error Logs** section showing the last 50 errors with timestamps, paths, and full tracebacks

### 2d. Security Test Suite (backend/tests/test_security.py) ✅

Covers:
- JWT tampering: modified payload rejected, bad signature rejected, expired token rejected
- IDOR: user A cannot read or modify user B's grants, loans, prices, or events
- File upload: oversized file rejected, non-XLSX magic bytes rejected
- Admin endpoints: return 403 for non-admin authenticated users

### 2e. Dependency Auditing in CI ✅

Added to `.github/workflows/test.yml`:
- `pip-audit` on Python dependencies
- `npm audit --audit-level=high` on frontend dependencies

---

## 3. SSH Hardening — ⚠️ Pending

> **Status: Port 22 is open and still allows password authentication. Key-based auth works but password auth is not yet disabled.**

### Steps (in order — do not disable password auth before adding your key)

1. ✅ SSH key added to `~/.ssh/authorized_keys` (GitHub Actions deploys via key)
2. ⬜ Edit `/etc/ssh/sshd_config` to disable password auth and root login:
   ```
   PasswordAuthentication no
   PermitRootLogin no
   ```
3. ⬜ Reload: `systemctl reload sshd`
4. ⬜ Create a non-root deploy user:
   ```bash
   useradd -m -s /bin/bash deploy
   usermod -aG docker deploy
   mkdir -p /home/deploy/.ssh
   cp ~/.ssh/authorized_keys /home/deploy/.ssh/
   chown -R deploy:deploy /home/deploy/.ssh
   chmod 700 /home/deploy/.ssh
   chmod 600 /home/deploy/.ssh/authorized_keys
   ```
5. ⬜ Update the `SSH_PRIVATE_KEY` GitHub Actions secret to use the deploy user's key
6. ⬜ Update `deploy.yml` to SSH as `deploy@<host>` instead of `root@<host>`

> Note: Port 22 is exposed directly (not behind Cloudflare — Cloudflare only proxies HTTP/S). Disabling password auth is the critical step here.

---

## Implementation Order

| # | Item | Status |
|---|------|--------|
| 1 | Cloudflare setup + WAF rules | ✅ Done |
| 2 | VPS firewall locked to CF IPs only | ✅ Done |
| 3 | Security headers in Caddyfile | ✅ Done |
| 4 | File upload hardening | ✅ Done |
| 5 | Hybrid 500 sanitization + error log UI | ✅ Done |
| 6 | Security test suite | ✅ Done |
| 7 | pip-audit + npm audit in CI | ✅ Done |
| 8 | SSH: disable password auth + deploy user | ⚠️ Pending |
