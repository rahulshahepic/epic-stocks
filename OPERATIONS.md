# Operations Guide

This document covers deployment, security hardening, monitoring, and incident response. **Sections marked "Infrastructure" are not in this repository and must be configured manually for each deployment.** Sections marked "In this repo" apply automatically to all deployments.

---

## 1. Edge Protection (Infrastructure — not in this repo)

> This must be configured by whoever operates the deployment. Self-hosters should follow these steps.

The reference deployment uses **Cloudflare** in front of Caddy. Cloudflare's built-in DDoS protection handles rate limiting at the edge — no explicit WAF rules are needed. The one application-layer exception is `POST /api/admin/test-notify`, capped at **5 calls per hour per admin** regardless of deployment setup.

### Steps for self-hosters

1. Add your site to Cloudflare (free tier is sufficient), update nameservers at your registrar
2. Set SSL/TLS mode to **Full (Strict)** — Caddy provisions a Let's Encrypt cert; Cloudflare validates it end-to-end
3. Lock your VPS firewall to allow ports 80/443 **only from Cloudflare IP ranges**:
   - IPv4: https://www.cloudflare.com/ips-v4
   - IPv6: https://www.cloudflare.com/ips-v6
   - This prevents attackers from bypassing Cloudflare by hitting your origin IP directly
4. Caddy receives real client IPs via the `CF-Connecting-IP` header — no extra app config needed

> **Self-hosting without Cloudflare?** The app has no general request-rate limiting beyond the admin test-notify cap. Add Caddy's [`rate_limit` directive](https://caddyserver.com/docs/caddyfile/directives/rate_limit) or `slowapi` FastAPI middleware before exposing to the internet.

### Privacy page for self-hosters

The built-in privacy page (`/privacy`, `frontend/src/scaffold/pages/PrivacyPolicy.tsx`) lists the third-party services used by the reference deployment: **Hetzner, Cloudflare, Porkbun, Resend**, and whichever OIDC providers are configured. If you use different infrastructure or identity providers, edit that file to reflect your own services before going to users.

### Reference deployment status

| Step | Status |
|------|--------|
| Cloudflare active, nameservers updated | ✅ Done |
| SSL/TLS Full (Strict) | ✅ Done |
| VPS firewall locked to CF IPs only | ✅ Done |

---

## 2. Application-Level Security (In this repo — applies to all deployments)

These are implemented in the codebase. Self-hosters get them automatically.

### Security headers (Caddyfile)

All responses include:

| Header | Value |
|--------|-------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' <OIDC-provider-origins>; frame-ancestors 'none'` — adjust `connect-src` to include your OIDC provider origins (e.g. `https://accounts.google.com`, `https://login.microsoftonline.com`). The Caddyfile sets this header; update it to match your configured providers. |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` |

### File upload hardening (`backend/app/routers/import_export.py`)

- Reject files larger than **5 MB** before parsing
- Validate **XLSX magic bytes** (`PK\x03\x04`) before passing to openpyxl
- Validate sheet structure and row data before committing anything to the database

### Error sanitization

- Unhandled exceptions are logged to the `error_logs` DB table (timestamp, path, method, error, traceback, user ID)
- Non-admin users receive a generic `"Internal server error"` — no stack traces leaked
- Admin users see full error detail in the response and in the admin dashboard Error Logs section

### Security test suite (`backend/tests/test_security.py`)

- JWT tampering: modified payload, bad signature, expired token all rejected (via session cookie — no Bearer token; signature verification via joserfc)
- IDOR: user A cannot read or modify user B's data
- File upload: oversized files and non-XLSX magic bytes rejected
- Admin endpoints: 403 for non-admin authenticated users

### Auth / XSS posture

The app uses the BFF (Backend For Frontend) session cookie pattern. The JWT never touches JavaScript: it is stored in an `HttpOnly; Secure; SameSite=Lax` cookie set by the backend at login. There is no Bearer token and no `localStorage` usage for auth. A successful XSS attack can make authenticated API calls within an active session (unavoidable with cookie auth) but cannot exfiltrate the credential for use from an external origin.

### Dependency auditing (CI)

`.github/workflows/test.yml` runs on every push to `main`/`staging` and on every PR:
- `pip-audit` on Python dependencies
- `npm audit --audit-level=high` on frontend dependencies
- `caddy validate` against the Caddyfile (catches syntax errors before deploy)
- E2E tests via Playwright (depends on backend + frontend passing)

`.github/workflows/branch-check.yml` enforces that PRs to `main` must originate from the `staging` branch.

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

1. Generates any missing server-side secrets (JWT, encryption key, VAPID keys, Postgres password) into `/opt/epic-stocks/.secrets/`, then writes `.env` from those files plus GitHub Secrets/Vars. Also writes `COMMIT_SHA=${{ github.sha }}` into `.env` so it is available as a Docker build arg.
2. Creates a 2 GB swapfile if one doesn't exist (idempotent)
3. `git fetch origin main && git reset --hard origin/main` — always matches the repo exactly; no local drift
4. `docker compose build` — passes `COMMIT_SHA` as a build arg to the frontend stage; Vite bakes it in as `VITE_COMMIT_SHA`. The resulting 7-char short hash is displayed in small text at the bottom of the Admin and Settings pages so testers can confirm which build is running. `docker compose up -d`
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

These are the only values that need to be set in GitHub. Cryptographic secrets (JWT, encryption key, VAPID keys, Postgres password) are generated on the server on first deploy and never stored in GitHub.

| Name | Type | Description |
|------|------|-------------|
| `VPS_SSH_KEY` | Secret | Private SSH key for the deploy user |
| `VPS_USER` | Secret | SSH username on the VPS |
| `ADMIN_EMAIL` | Secret | Semicolon-delimited admin email(s) |
| `RESEND_API_KEY` | Secret | Resend email API key |
| `RESEND_FROM` | Secret | Sender address for transactional email |
| `OIDC_PROVIDERS` | Secret | JSON array of OIDC provider configs (see README for format) |
| `ACME_EMAIL` | Variable | Email for Let's Encrypt certificate notifications |
| `VPS_HOST` | Variable | VPS hostname or IP |
| `DOMAIN` | Variable | Your domain name |
| `TRUSTED_PROXY_IPS` | Variable | Cloudflare IP ranges for real-IP forwarding |


### Multi-app network

`docker-compose.multiapp.yml` no longer exists. `docker-compose.yml` always joins the shared `proxy` Docker network. The deploy script automatically creates the `proxy` network and manages the infra Caddy container — no separate compose file or manual setup is required.

### Server-generated secrets

The following are generated once on first deploy, written to `/opt/epic-stocks/.secrets/` (mode 700, files mode 600), and read from there on every subsequent deploy. They never appear in GitHub.

| Location | Description |
|----------|-------------|
| `.secrets/jwt_secret` | 32-byte hex string for JWT signing |
| `.secrets/postgres_password` | 32-byte hex string for the PostgreSQL superuser |
| `.secrets/vapid_private_key` | P-256 EC private key for Web Push |
| `.secrets/vapid_public_key` | Corresponding P-256 public key (served to browsers) |
| `.secrets/key_encryption_key` | KEK that wraps the operational master key stored in the database. Set once, never changes in normal operations. The operational master key itself lives in the `system_settings` DB table and can be rotated live from the admin panel without touching this file. |

On transition from a prior setup, the deploy script seeds `.secrets/` files from the existing `.env` before generating fresh values, so no data loss occurs.

| Step | Status |
|------|--------|
| Caddy config validated in CI before every deploy | ✅ Done |
| Server-generated secrets persisted in `.secrets/`, not GitHub | ✅ Done |
| `.env` written from server secrets + GitHub vars on every deploy | ✅ Done |
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

## 6. Backups (Infrastructure — not in this repo)

### Strategy: Hetzner server snapshots

The reference deployment uses **Hetzner automated backups** (daily, 7-day retention). A snapshot captures the entire server — disk image, Docker volumes (`pg_data`, `caddy_data`), and the `/opt/epic-stocks/.secrets/` directory containing the server-generated cryptographic keys.

This is the primary backup and key-recovery mechanism. Because the secrets files and the database live on the same server, a snapshot always contains them together and in a consistent state. Restoring a snapshot to a new Hetzner server and running the deploy is sufficient for full recovery.

> **Application-level snapshots** are also created automatically before each Excel import (last 3 kept per user, restorable via the API). These are not a substitute for server backups.

### Steps

1. In the Hetzner Cloud Console, select the server → **Backups** → enable automatic backups
2. Hetzner retains the last 7 daily backups automatically (billed at ~20% of server cost)
3. Before any major change (schema migrations, infrastructure changes), take a **manual snapshot** from the console as an additional restore point

### Restore procedure

1. In Hetzner Console → **Snapshots / Backups** → select the backup → **Rebuild** (creates new server from snapshot) or restore in place
2. SSH in and run the deploy: `git push origin main` triggers CI which re-deploys from the now-running server state
3. Verify: `curl https://<domain>/api/health`

### Reference deployment status

| Step | Status |
|------|--------|
| Hetzner automated backups enabled | ⚠️ Pending |
| Pre-migration manual snapshot habit | ⚠️ Pending |

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
