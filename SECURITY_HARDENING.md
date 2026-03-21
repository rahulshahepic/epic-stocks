# Security Hardening Plan

Three areas in priority order. Sections 1 and 3 are infrastructure tasks requiring server/DNS access; Section 2 is implemented in this repo.

---

## 1. Cloudflare (DDoS / bot protection) — Infrastructure Task

> **Status: Manual — requires DNS/Cloudflare access**

### Steps

1. Add site to Cloudflare free tier, update nameservers at domain registrar
2. Set SSL/TLS mode to **Full (Strict)** (Caddy already provisions a cert from Let's Encrypt; Cloudflare validates it end-to-end)
3. Confirm "Under Attack Mode" is available in the Cloudflare dashboard (enable only during active attacks — it adds a JS challenge for all visitors)
4. Create WAF rate-limiting rules:
   - Block IPs that hit `/api/auth/*` more than **10 req/min**
   - Block IPs that hit `/api/*` more than **200 req/min**
5. Lock Hetzner Firewall (or equivalent VPS firewall) to allow ports 80/443 **only from Cloudflare IP ranges**:
   - IPv4: https://www.cloudflare.com/ips-v4
   - IPv6: https://www.cloudflare.com/ips-v6
   - This prevents attackers from bypassing Cloudflare by hitting the origin IP directly
6. Verify Caddy receives real client IPs via the `CF-Connecting-IP` header (Cloudflare sets this; Caddy passes it through — no extra config needed for logging, but if you add IP-based logic in the app, read this header, not `X-Forwarded-For`)

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

## 3. SSH Hardening — Infrastructure Task

> **Status: Manual — requires server SSH access**

### Steps (in order — do not disable password auth before adding your key)

1. Add your public SSH key to `~/.ssh/authorized_keys` on the server
2. Verify you can log in with the key **before** changing sshd config
3. Edit `/etc/ssh/sshd_config`:
   ```
   PasswordAuthentication no
   PermitRootLogin no
   ```
4. Reload: `systemctl reload sshd`
5. Create a non-root deploy user:
   ```bash
   useradd -m -s /bin/bash deploy
   usermod -aG docker deploy
   mkdir -p /home/deploy/.ssh
   cp ~/.ssh/authorized_keys /home/deploy/.ssh/
   chown -R deploy:deploy /home/deploy/.ssh
   chmod 700 /home/deploy/.ssh
   chmod 600 /home/deploy/.ssh/authorized_keys
   ```
6. Update the `SSH_PRIVATE_KEY` GitHub Actions secret to use the deploy user's key
7. Update `deploy.yml` to SSH as `deploy@<host>` instead of `root@<host>`

---

## Implementation Order

| # | Item | Status |
|---|------|--------|
| 1 | Cloudflare setup + WAF rules | Manual |
| 2 | Hetzner firewall locked to CF IPs | Manual |
| 3 | Security headers in Caddyfile | ✅ Done |
| 4 | File upload hardening | ✅ Done |
| 5 | Hybrid 500 sanitization + error log UI | ✅ Done |
| 6 | Security test suite | ✅ Done |
| 7 | pip-audit + npm audit in CI | ✅ Done |
| 8 | SSH hardening + deploy user | Manual |
