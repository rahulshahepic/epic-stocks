# Security Hardening

This document covers three layers of security. **Sections 1 and 3 are infrastructure tasks — they are not in this repository and must be configured manually for each deployment.** Section 2 is implemented in the repo and applies automatically to anyone who self-hosts.

---

## 1. Edge Protection (Infrastructure — not in this repo)

> This must be configured by whoever operates the deployment. Self-hosters should follow these steps.

The reference deployment uses **Cloudflare** in front of Caddy. No general app-level rate limiting is implemented — Cloudflare handles it at the edge. The one exception is `POST /api/admin/test-notify`, which is capped at **5 calls per hour per admin** in the application layer regardless of deployment setup.

### Steps for self-hosters

1. Add your site to Cloudflare (free tier is sufficient), update nameservers at your registrar
2. Set SSL/TLS mode to **Full (Strict)** — Caddy provisions a Let's Encrypt cert; Cloudflare validates it end-to-end
3. Create WAF rate-limiting rules:
   - Block IPs hitting `/api/auth/*` more than **10 req/min**
   - Block IPs hitting `/api/*` more than **200 req/min**
4. Lock your VPS firewall to allow ports 80/443 **only from Cloudflare IP ranges**:
   - IPv4: https://www.cloudflare.com/ips-v4
   - IPv6: https://www.cloudflare.com/ips-v6
   - This prevents attackers from bypassing Cloudflare by hitting your origin IP directly
5. Caddy receives real client IPs via the `CF-Connecting-IP` header — no extra app config needed

> **Self-hosting without Cloudflare?** The app has no general request-rate limiting beyond the admin test-notify cap. Add Caddy's [`rate_limit` directive](https://caddyserver.com/docs/caddyfile/directives/rate_limit) or `slowapi` FastAPI middleware before exposing to the internet.

### Reference deployment status

| Step | Status |
|------|--------|
| Cloudflare active, nameservers updated | ✅ Done |
| SSL/TLS Full (Strict) | ✅ Done |
| WAF rate-limiting rules | ✅ Done |
| VPS firewall locked to CF IPs only | ✅ Done |

---

## 2. Application-Level Security (In this repo — applies to all deployments)

These are implemented in the codebase. Self-hosters get them automatically.

### Security headers (Caddyfile)

All responses include:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://accounts.google.com; frame-ancestors 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` |

### File upload hardening (`backend/routers/import_export.py`)

- Reject files larger than **5 MB** before parsing
- Validate **XLSX magic bytes** (`PK\x03\x04`) before passing to openpyxl
- Validate sheet structure and row data before committing anything to the database

### Error sanitization

- Unhandled exceptions are logged to the `error_logs` DB table (timestamp, path, method, error, traceback, user ID)
- Non-admin users receive a generic `"Internal server error"` — no stack traces leaked
- Admin users see full error detail in the response and in the admin dashboard Error Logs section

### Security test suite (`backend/tests/test_security.py`)

- JWT tampering: modified payload, bad signature, expired token all rejected
- IDOR: user A cannot read or modify user B's data
- File upload: oversized files and non-XLSX magic bytes rejected
- Admin endpoints: 403 for non-admin authenticated users

### Dependency auditing (CI)

`.github/workflows/test.yml` runs on every push and PR:
- `pip-audit` on Python dependencies
- `npm audit --audit-level=high` on frontend dependencies

---

## 3. SSH Hardening (Infrastructure — not in this repo)

> This must be configured manually on the server. Self-hosters should do this before going to production.

Port 22 is not behind Cloudflare (Cloudflare only proxies HTTP/S). The critical step is disabling password authentication so the only attack surface is a stolen SSH private key.

> A separate non-root deploy user is not worth the complexity here: any user that can run `docker` commands has effective root access (docker group = root equivalent). Disabling password auth is the real protection.

### Steps

1. Add your SSH public key to `~/.ssh/authorized_keys` on the server
2. Verify key-based login works **before** disabling password auth
3. Edit `/etc/ssh/sshd_config`:
   ```
   PasswordAuthentication no
   PermitRootLogin prohibit-password
   ```
4. Reload: `systemctl reload sshd`

### Reference deployment status

| Step | Status |
|------|--------|
| SSH key added, GitHub Actions deploys via key | ✅ Done |
| Password authentication disabled | ⚠️ Pending |

---

## 4. Uptime Monitoring (Infrastructure — not in this repo)

> This must be configured by whoever operates the deployment. Without it, a broken deploy can go undetected until manually noticed.

The reference deployment experienced a silent outage when `caddy:2` pulled a new version with a breaking Caddyfile syntax change. CI now validates the Caddyfile before every deploy (see `.github/workflows/test.yml`), and the deploy job polls `/api/health` after startup (see `.github/workflows/deploy.yml`). External uptime monitoring provides the final safety net for issues that slip through.

### Option A: UptimeRobot (free tier)

1. Create an account at [uptimerobot.com](https://uptimerobot.com)
2. Add a new **HTTP(S)** monitor:
   - **URL:** `https://<your-domain>/api/health`
   - **Monitoring interval:** 5 minutes
   - **Alert condition:** response body does not contain `"ok"` OR HTTP status is not 200
3. Add an alert contact (email and/or SMS) — free tier supports email alerts
4. Verify the monitor shows "Up" and test by temporarily returning a non-200 from health check

### Option B: Better Uptime (free tier)

1. Create an account at [betteruptime.com](https://betteruptime.com)
2. Add a **HTTP** monitor for `https://<your-domain>/api/health`
3. Set check frequency to 3 minutes (free tier minimum)
4. Configure on-call escalation with SMS + email

### Option C: Cloudflare Health Checks (paid plans)

1. In Cloudflare dashboard → **Traffic → Health Checks**
2. Create a health check:
   - **URL:** `https://<your-domain>/api/health`
   - **Type:** HTTP
   - **Interval:** 60s (minimum on paid plans)
   - **Expected response:** body contains `ok`
3. Attach a notification policy to send email/webhook on failure

### Goal

Alert within **5 minutes** of downtime. All three options above achieve this on free or low-cost plans.

### Reference deployment status

| Step | Status |
|------|--------|
| Caddy config validated in CI before every deploy | ✅ Done |
| Deploy polls `/api/health` and fails loudly on outage | ✅ Done |
| External uptime monitor (UptimeRobot / Better Uptime / CF) | ⚠️ Pending |
