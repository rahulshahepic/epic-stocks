# Operations Guide

This document covers deployment, security hardening, monitoring, and incident response. **Sections marked "Infrastructure" are not in this repository and must be configured manually for each deployment.** Sections marked "In this repo" apply automatically to all deployments.

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

## 4. Deploy Pipeline (In this repo — applies to all deployments)

The deploy pipeline lives in `.github/workflows/deploy.yml` and runs on every push to `main`.

### How it works

**Step 1 — Caddy config validation (`caddy-validate` job)**

Before anything touches the server, a Docker container runs `caddy validate` against the Caddyfile. `caddy:2` is intentionally **unpinned** so CI catches any breaking syntax changes introduced by new Caddy releases before they reach production. This was motivated by a real silent outage where `caddy:2` pulled a new version with a breaking change.

**Step 2 — Deploy (`deploy` job, runs only if `caddy-validate` passes)**

Connects to the VPS via SSH (key stored in GitHub Actions secrets) and:

1. Writes `.env` from GitHub Secrets/Vars — the VPS never stores secrets manually
2. Creates a 2 GB swapfile if one doesn't exist (idempotent)
3. `git fetch origin main && git reset --hard origin/main` — always matches the repo exactly; no local drift
4. `docker compose build && docker compose up -d`
5. Polls `http://localhost/api/health` every 5 seconds for up to 60 seconds

**Step 3 — Health polling**

If `/api/health` returns `{"status": "ok"}` within 60 seconds, the deploy succeeds. If not, the job prints diagnostic information and exits 1 (fails the workflow):

```
=== docker compose ps ===
=== docker compose logs (last 40 lines) ===
=== recent commits ===
MANUAL ROLLBACK INSTRUCTIONS: ...
```

No automatic rollback. Because Alembic migrations run on startup, reverting code after a schema migration requires manual review (see §7 Runbook).

### GitHub Actions secrets and variables required

| Name | Type | Description |
|------|------|-------------|
| `VPS_SSH_KEY` | Secret | Private SSH key for the deploy user |
| `JWT_SECRET` | Secret | Random 32+ byte string for JWT signing |
| `POSTGRES_PASSWORD` | Secret | PostgreSQL password |
| `ADMIN_EMAIL` | Secret | Semicolon-delimited admin email(s) |
| `VAPID_PRIVATE_KEY` | Secret | VAPID private key for push notifications |
| `RESEND_API_KEY` | Secret | Resend email API key |
| `RESEND_FROM` | Secret | Sender address for transactional email |
| `PRIVACY_URL` | Secret | URL to your privacy policy |
| `VPS_USER` | Secret | SSH username on the VPS |
| `VPS_HOST` | Variable | VPS hostname or IP |
| `GOOGLE_CLIENT_ID` | Variable | Google OAuth client ID |
| `DOMAIN` | Variable | Your domain name |
| `VAPID_PUBLIC_KEY` | Variable | VAPID public key |
| `VAPID_CLAIMS_EMAIL` | Variable | Contact email for VAPID claims |
| `TRUSTED_PROXY_IPS` | Variable | Cloudflare IP ranges for real-IP forwarding |

### Reference deployment status

> **Encryption master key** — `ENCRYPTION_MASTER_KEY` is **not** a GitHub secret. On first deploy the script generates a 256-bit key (`openssl rand -hex 32`) and writes it to `./data/current_master_key` on the VPS. All subsequent deploys read from that file. To rotate the key, use the **Rotate encryption key** action in the admin panel — the file is updated automatically, no deploy or secret change needed. If you previously had `ENCRYPTION_MASTER_KEY` set as a GitHub secret, the first deploy after this change will migrate it to the file and you can then delete the secret.

| Step | Status |
|------|--------|
| Caddy config validated in CI before every deploy | ✅ Done |
| `.env` written from GitHub secrets on every deploy | ✅ Done |
| Encryption master key auto-generated on-disk, never in GitHub | ✅ Done |
| Deploy polls `/api/health` and fails loudly on outage | ✅ Done |
| Swapfile created automatically if missing | ✅ Done |

---

## 5. Uptime Monitoring (Infrastructure — not in this repo)

> This must be configured by whoever operates the deployment. Without it, a broken deploy can go undetected until manually noticed.

CI catches most failures (Caddyfile validation + health polling), but external monitoring catches anything that happens between deploys — server reboots, OOM kills, disk full, upstream issues.

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
| External uptime monitor (UptimeRobot / Better Uptime / CF) | ⚠️ Pending |

---

## 6. Database Backups (Infrastructure — not in this repo)

> Not yet configured. This section is a placeholder for the backup strategy.

The application data lives in a PostgreSQL container. Key considerations:

- **What to back up:** the `vesting` database (grants, loans, prices, users, error_logs, push subscriptions)
- **Application-level snapshots** are already created automatically before each Excel import (last 3 kept per user, restorable via the API) — these are not a substitute for database-level backups
- **Suggested approach:** daily `pg_dump` piped to an off-site location (S3, Backblaze B2, or similar), retained for 30 days

### To-do

- [ ] Set up automated `pg_dump` (cron or systemd timer on the VPS)
- [ ] Ship dumps off-site automatically
- [ ] Verify restore procedure (test restore to a throwaway container monthly)
- [ ] Document RTO/RPO targets

---

## 7. Runbook

### Health check fails after deploy

The deploy job will print diagnostics and exit 1. Steps to investigate:

1. Check the GitHub Actions log for the printed `docker compose ps` and `docker compose logs` output
2. SSH into the VPS: `ssh <user>@<host>`
3. In `/opt/epic-stocks`:
   ```
   docker compose ps
   docker compose logs --tail=100
   ```
4. Check if a migration ran:
   ```
   docker compose exec db psql -U postgres -d vesting \
     -c 'SELECT version_num FROM alembic_version;'
   ```

### Rolling back after a failed deploy

**No schema migration ran** (most common):
```bash
git checkout <previous-sha>
docker compose build
docker compose up -d
```

**A schema migration ran:**
1. Identify the previous Alembic version from the deploy log or git history
2. Run the downgrade manually:
   ```
   docker compose exec backend alembic downgrade <previous-version>
   ```
3. Roll back the code:
   ```
   git checkout <previous-sha>
   docker compose build && docker compose up -d
   ```
4. Verify health: `curl http://localhost/api/health`

> Rolling back code without reverting the Alembic migration first will cause the app to fail on startup with a schema mismatch.

### Service is up but behaving incorrectly

- Check error logs in the admin dashboard → Error Logs section
- Check `docker compose logs backend --tail=200` for unhandled exceptions
- Check `docker compose logs caddy` for upstream/TLS errors

### OOM kill / server unresponsive

- The deploy job creates a 2 GB swapfile on first run; verify it's still active: `swapon --show`
- Check memory: `free -h` and `docker stats`
- If the DB container was OOM-killed, PostgreSQL will recover on restart: `docker compose restart db`
