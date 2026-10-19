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
4. Set the GitHub Actions **variable** `CLIENT_IP_HEADER` to `CF-Connecting-IP`
   - Cloudflare sends this header with exactly the original caller's address
   - Step 3 is what makes it trustworthy: with the origin reachable only from
     Cloudflare, nobody else can set it. **Do not set this variable without step 3** —
     an exposed origin would let anyone forge an address and mint a fresh
     rate-limit bucket per request
   - The alternative is `TRUSTED_PROXY_HOPS=2` (Cloudflare + Caddy = two proxies).
     It works, but it is counted rather than named, and the default of `1` resolves
     every caller to a Cloudflare edge address instead — see below
5. Verify it, do not assume it: sign in as an admin and open
   `https://<your domain>/api/admin/client-ip`. `resolved_ip` must be the address you
   are actually browsing from (check against e.g. `curl ifconfig.me`) and
   `looks_correct` must be `true`. If it shows a Cloudflare address, every anonymous
   rate limit in the app is keyed on the edge rather than the caller, which collapses
   all visitors in a region into one shared bucket

> **Self-hosting without Cloudflare?** The app has no general request-rate limiting beyond the admin test-notify cap. Add Caddy's [`rate_limit` directive](https://caddyserver.com/docs/caddyfile/directives/rate_limit) or `slowapi` FastAPI middleware before exposing to the internet.

### Cloudflare's AI-bot blocking breaks AI connectors

Cloudflare can challenge AI agents — including OpenAI's `ChatGPT-User` — with a
**403 before the request reaches the origin**. This deployment has two custom
WAF rules: `Bots MCP` skips Bot Fight Mode and UA blocking for connector paths,
while `No bots on non mcp` challenges bot traffic outside those paths. Both
rules must use the same path expression. A Skip rule that only skips Bot Fight
Mode does **not** bypass a later custom challenge rule. The symptom is:

> Error creating connector — Dynamic client registration failed: registration
> endpoint returned 403

Nothing in the application logs shows it, because nothing reaches the
application. Confirm it from any machine:

```bash
# A challenge is a Cloudflare HTML 403 with cf-mitigated: challenge.
# Invalid metadata avoids registering a probe client; an app response is JSON 400.
curl -i -X POST https://<your domain>/admin-oauth/register \
  -H 'Content-Type: application/json' \
  -A 'ChatGPT-User/1.0; +https://openai.com/bot' \
  -d '{}'
```

**Fix — Cloudflare dashboard → Security → WAF → Custom rules.** Keep the
existing `Bots MCP` Skip rule before `No bots on non mcp`. Set the Skip rule's
expression to the following; its action skips **Bot Fight Mode**
(`http_request_sbfm`) and **UA blocking** (`uaBlock`):

```text
(http.request.uri.path in {"/mcp" "/admin-mcp" "/.well-known/oauth-protected-resource" "/.well-known/oauth-protected-resource/mcp" "/.well-known/oauth-protected-resource/admin-mcp" "/.well-known/oauth-authorization-server" "/.well-known/oauth-authorization-server/mcp" "/.well-known/oauth-authorization-server/admin-mcp" "/.well-known/oauth-authorization-server/admin-oauth"}) or starts_with(http.request.uri.path, "/oauth/") or starts_with(http.request.uri.path, "/admin-oauth/")
```

Edit `No bots on non mcp` as well: its expression must be **not (the same
allowed-path expression)**, joined with its existing bot-detection condition.
Preserve its `managed_challenge` action. Do not put `"/admin-oauth/*"` in the
path set: the asterisk there is literal, so it will never match OAuth routes.
For this deployment, the complete challenge expression is:

```text
not ((http.request.uri.path in {"/mcp" "/admin-mcp" "/.well-known/oauth-protected-resource" "/.well-known/oauth-protected-resource/mcp" "/.well-known/oauth-protected-resource/admin-mcp" "/.well-known/oauth-authorization-server" "/.well-known/oauth-authorization-server/mcp" "/.well-known/oauth-authorization-server/admin-mcp" "/.well-known/oauth-authorization-server/admin-oauth"}) or starts_with(http.request.uri.path, "/oauth/") or starts_with(http.request.uri.path, "/admin-oauth/")) and (cf.client.bot or len(http.user_agent) == 0 or (not http.request.headers["accept"][0] contains "text/html" and http.request.uri.path eq "/"))
```

For a new deployment without these two rules, create the Skip rule and either
exclude these paths from any custom challenge rule or have the Skip action
also skip **all remaining custom rules**. Keep other security protections
unless you have verified that they block the connector.

Scope it to those paths and no further. The rest of the site keeps its AI-bot
blocking, and the paths being opened are ones designed to face unauthenticated
callers: `/oauth/register` is anonymous by necessity (it is what lets Claude on
a phone connect), `/oauth/token` and `/admin-oauth/token` require PKCE, and both MCP endpoints require a connector
token. Their own bounds are described in the README's AI Connections section.

The current rules are zone-wide, so they cover both hostnames; deploy the
admin MCP to production before connecting its production URL. On a phone,
open Cloudflare → Security → WAF → Custom rules, edit **both** rules, save,
then create each diagnostic connection from the downloads in Admin → AI Connections.
Verify staging: unauthenticated `GET /admin-mcp` returns JSON 405, POST
`/admin-mcp` returns 401 with admin resource metadata, the two admin
`/.well-known/` discovery URLs return 200, and invalid POST
`/admin-oauth/register` returns JSON 400. A Cloudflare HTML 403 means the
request never reached the app; inspect its Ray ID in Security Events.

### Add the admin diagnostic connections

1. On staging, open **Admin → AI Connections** on your phone. Check that
   **Allow AI connections** and the provider you will use are enabled.
2. Download **staging diagnostics → ChatGPT ZIP** or **Claude ZIP**. On a phone,
   open ChatGPT's [Plugins web page](https://chatgpt.com/plugins) and use
   **+ → Upload plugin**, or Claude's **Customize → Plugins → Upload**. Select
   the ZIP from Files, review the connection, and proceed to sign-in. The
   package contains the exact endpoint; nobody needs to paste it.
3. Sign in to **staging** with an account listed in staging's `ADMIN_EMAIL`,
   approve the `admin:read` consent screen, and ask the newly named connector
   for `admin_deployment_status`. Confirm it reports `staging` and the expected
   API build. This completes the authenticated check that unauthenticated
   probes cannot perform.
4. Only **after the admin MCP is deployed to production**, download the
   **production diagnostics** ZIP and install it as a second plugin. Sign in to production and confirm its
   environment is `production`. The personal-data connector remains the
   separate production plugin downloaded from Settings → AI Connections.
5. Phone acceptance: confirm both hosts accept their ZIP, complete OAuth,
   discover only the intended tools and keep staging/production separate.
   A passing package-shape test alone does not establish host compatibility.

The [README's AI Connections section](README.md#ai-connections-admin) describes
the four diagnostic tools and how to revoke a connection.

If a deployment does **not** want AI connectors at all, the better lever is the
admin switch (Admin → AI Connections → *Allow AI connections*), which turns the
feature off in the app rather than leaving it half-reachable at the edge.

### Privacy page for self-hosters

The built-in privacy page (`/privacy`, `frontend/src/scaffold/pages/PrivacyPolicy.tsx`) lists the third-party services used by the reference deployment: **Hetzner, Cloudflare, Porkbun, Resend**, and whichever OIDC providers are configured. If you use different infrastructure or identity providers, edit that file to reflect your own services before going to users.

### Reference deployment status

| Step | Status |
|------|--------|
| Cloudflare active, nameservers updated | ✅ Done |
| SSL/TLS Full (Strict) | ✅ Done |
| VPS firewall locked to CF IPs only | ✅ Done |
| `CLIENT_IP_HEADER=CF-Connecting-IP` set | ⬜ Check — see step 4 |
| `/api/admin/client-ip` shows your real address | ⬜ Check — see step 5 |
| WAF connector Skip and custom challenge rules | ✅ Zone-wide paths corrected; staging admin discovery, auth challenge and registration reach the app. Check production admin after deploying it |

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

### Request body ceiling (Caddyfile + app)

Caddy refuses any request body over **16 MB** (`request_body { max_size 16MB }`),
so an oversized upload is rejected at the edge and never reaches the app. If you
add an endpoint that legitimately accepts more, raise it in both `caddy/Caddyfile`
and `caddy/app.caddy`.

The app enforces its own, tighter ceiling per path in
`backend/scaffold/body_limit.py` — 1 MB for JSON endpoints, and the sum of the
files each multipart endpoint accepts. Both are needed: the proxy limit is where
a flood should die, and the app limit is the one that still applies to anything
that reaches the container directly. The app's ceiling is applied in the ASGI
layer, *before* the multipart parser spools anything, so an anonymous caller
cannot make the server write megabytes to disk on the way to a 401.

### Problem reports (`backend/scaffold/routers/reports.py`)

`POST /api/report` is unauthenticated by design — someone who cannot sign in must still be able to report it. What that costs, and what pays for it:

- Message capped at 2000 characters, client log at 8 KB, user agent at 400 — everything over the cap is truncated, not rejected.
- Two rate limits: **30 per 15 min per client IP** and **10 per 15 min per authenticated user**. Note that uvicorn runs without `--proxy-headers`, so behind Caddy `request.client.host` is the proxy for every request and the IP bucket is effectively global. That is why it is loose: an outage produces a burst of reports, and the limit must not silence it. The per-user limit is the precise one.
- The stored `ip_hash` is an HMAC, never the address, and behind a reverse proxy it is the proxy's address — it only distinguishes reporters on a directly-exposed deployment.
- Reports are stored in `user_reports`. Unlike `error_logs`, that table is **not** trimmed by the nightly job, so it grows with real usage — watch it in **Admin → Database Tables** and delete handled reports.
- Each report emails every address in `ADMIN_EMAIL` when email is configured. Sending is best-effort: a mailer failure is logged and never fails the submission.

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
- `npm audit --audit-level=high` on frontend dependencies
- `caddy validate` against the Caddyfile (catches syntax errors before deploy)
- E2E tests via Playwright (depends on backend + frontend passing)

`.github/workflows/security-audit.yml` runs `pip-audit` on Python dependencies weekly (Mondays 12:00 UTC) and on manual `workflow_dispatch`. It is intentionally off the PR hot path — a failure notifies via GitHub's standard scheduled-workflow email, it does not block merges.

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
4. `docker compose build` — passes `COMMIT_SHA` and `APP_ENV` as build args to the frontend stage. `VITE_COMMIT_SHA` is displayed as a 7-char short hash in Admin and Settings. `VITE_APP_ENV=staging` activates the staging visual identity (amber icon, renamed PWA, amber header banner). After the image is built and before taking down the current app, the workflow installs and restarts `epic-stocks-jobs.timer` from `ops/systemd/`. It remains enabled if a later deployment step fails. After the database is healthy, a one-off app container runs `alembic upgrade head`. The web app starts with `RUN_MIGRATIONS_ON_STARTUP=0` so it does not rerun migrations. Local PostgreSQL starts still run them by default.
5. Polls `http://localhost/api/health` every 5 seconds for up to 60 seconds

**Step 3 — Health polling**

If `/api/health` returns `{"status": "ok"}` within 60 seconds, the deploy succeeds. If not, the job prints diagnostic information and exits 1 (fails the workflow):

```
=== docker compose ps ===
=== docker compose logs (last 40 lines) ===
=== recent commits ===
MANUAL ROLLBACK INSTRUCTIONS: ...
```

No automatic rollback. The deploy runs Alembic before starting the app; reverting code after a schema migration requires manual review (see §7 Runbook).

### Daily jobs

`epic-stocks-jobs.timer` starts a one-off app container every 15 minutes. The container runs `python -m scheduled_jobs`, not Uvicorn. It runs nightly maintenance after 03:00 UTC, and notifications and the admin digest as separate jobs after 07:00 UTC. If installed after those times, the next firing runs the jobs for the current UTC day. Successful UTC dates live in `system_settings` as `scheduled:maintenance:last_completed`, `scheduled:notifications:last_completed`, and `scheduled:admin_digest:last_completed`; the corresponding `last_completed_at` keys record actual UTC finish times. A failed or missed job is retried at the next timer firing on the same day without rerunning the others. Successful digest recipients have individual hashed-address completion markers, so a partial email failure retries only those still pending. The timer is installed by `.github/workflows/deploy.yml` on both VPS hosts before the old app is taken down. No host-side manual installation is needed.

To inspect a deployment, check `systemctl status epic-stocks-jobs.timer`, `systemctl status epic-stocks-jobs.service`, and `journalctl -u epic-stocks-jobs.service -n 100`. Check the recorded days with `docker compose exec db psql -U postgres -d vesting -c "SELECT key, value FROM system_settings WHERE key LIKE 'scheduled:%:last_completed';"`. If the timer fails, fix the tracked service/timer or app code through a PR and redeploy; the next invocation catches up for the current UTC day. If a site is down past midnight, old notification days are intentionally not replayed. An external send can be repeated if the process dies after sending but before recording success; per-user `last_notified_at` limits repeat user notifications.

Admins can check this from a phone in **Admin → Deployment**. The API returns the running backend build, environment, last runner start and finish, latest job results and completion timestamps. The panel shows each due time for the current UTC job day in the phone's timezone and labels the completed UTC day. A completed notifications or digest job may have had no eligible recipients, and the panel cannot prove provider delivery. Runs completed before timestamps were introduced show their UTC day with the time unavailable until the next successful run. The panel warns if the check is older than 35 minutes, a job failed, a due job remains incomplete, or the frontend and backend builds differ. The runner writes its heartbeat in `system_settings` on each invocation; this measures actual job execution, not merely an enabled systemd timer. If the database itself is unavailable, the panel shows an error instead. It cannot display the GitHub Actions deployment result; use the Deploy workflow for that.

For local development with no systemd timer, run `docker compose run --rm app python -m scheduled_jobs` to check due jobs. The Hetzner workflow writes `DB_POOL_SIZE=10` and `DB_MAX_OVERFLOW=20` into `.env` unless overridden by GitHub environment variables, preserving the prior VPS pool capacity. For request-based hosting, schedule the same CLI every 15 minutes, set `RUN_MIGRATIONS_ON_STARTUP=0` after a separate migration step, and set `SAMPLE_SYSTEM_METRICS=0`; size `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, and maximum instance count together against the PostgreSQL connection limit.

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
| `CLIENT_IP_HEADER` | Variable | Header carrying the caller's address. `CF-Connecting-IP` behind Cloudflare. Only safe with the origin firewalled to the proxy. |
| `APP_ENV` | Variable | Set to `staging` in the staging GitHub environment to enable staging visual identity (amber icon, "Epic Stocks (Staging)" PWA name, amber header banner) and the Admin deployment label. Compose passes it to the frontend build and the app container. Omit or set to `production` for production — defaults to `production` if absent. |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | Variable | Optional VPS pool limits. Defaults to `10` / `20` per app process when not set. |


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

### ChatGPT portfolio UI

The optional GitHub environment variable `CHATGPT_UI_ORIGIN` is carried into the deploy `.env` and the app container. For public UI submission it must be a unique HTTPS origin owned by this plugin; omit it during development to use the host sandbox. After a tool/resource metadata change, refresh the connection in ChatGPT Plugins. See [host acceptance and rollout](docs/chatgpt-plugin.md).
