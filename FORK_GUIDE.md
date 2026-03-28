# Fork Guide

This repo is a full-stack PWA scaffold with equity-tracking app code built on top.
When forking to build a different app, you replace only the `app/` layer — the scaffold stays unchanged.

## What to keep (scaffold)

```
backend/scaffold/          auth, crypto, email, push notifications, admin
backend/scaffold/providers/  auth + email provider implementations
frontend/src/scaffold/     Login, Admin, Settings pages; Layout, Toast; hooks
infra/                     shared Caddy config for multi-app hosting
caddy/                     Caddyfile (single-app) and app.caddy snippet (multi-app)
docker-compose.yml         single-app deployment (always uses shared proxy network)
.github/workflows/deploy.yml
```

## What to replace (app layer)

```
backend/app/
  core.py              — domain event computation (frozen in this repo)
  sales_engine.py      — FIFO cost basis
  excel_io.py          — Excel import/export
  timeline_cache.py    — memoization
  routers/             — domain API endpoints

frontend/src/app/
  pages/               — domain UI pages
  hooks/               — domain data hooks (useApiData, useDataSync)
```

`backend/main.py` is the wiring file — update it to register your app's routers.

## Step-by-step

1. **Use as a GitHub template** — click "Use this template" on GitHub.

2. **Replace `backend/app/`** with your domain logic. Keep the same package structure (`backend/app/__init__.py`, `backend/app/routers/__init__.py`).

3. **Replace `frontend/src/app/`** with your domain pages and hooks.

4. **Update `backend/main.py`**:
   - Change the `from app.routers import ...` block to import your routers.
   - Register them with `app.include_router(...)`.

5. **Update Alembic** (`backend/alembic/versions/`) with your schema migrations. Delete the existing versions and create fresh ones with `alembic revision --autogenerate -m "initial"`.

6. **Update `backend/scaffold/models.py`** if you need new scaffold-level models (e.g., new per-user settings). For purely app-level models, add a `backend/app/models.py` and import it in `env.py`.

7. **Set environment variables** — see `.env.example`. Required at minimum:
   - `OIDC_PROVIDERS` (GitHub Secret) — JSON array of OIDC provider configs
   - `POSTGRES_PASSWORD`, `JWT_SECRET` (auto-generated on first deploy)
   - `DOMAIN`, `APP_URL`

8. **Configure GitHub Actions** — set vars/secrets as documented in `deploy.yml`.

## Auth providers

Set `OIDC_PROVIDERS` as a GitHub Secret containing a JSON array. It supports any OIDC-compliant IdP (Google, Azure Entra ID, Okta, etc.). Multiple providers show as separate "Sign in with X" buttons on the login page. No frontend changes needed — the PKCE flow is provider-agnostic.

**Session storage (BFF pattern):** After the PKCE code exchange, the backend issues a JWT stored in an `HttpOnly; Secure; SameSite=Lax` session cookie — never in `localStorage` or returned to JavaScript. Even if an XSS vulnerability existed in the app, an attacker's script cannot read the cookie and cannot replay it from another origin (`SameSite=Lax` blocks cross-site POST). A non-HttpOnly `auth_hint` cookie lets the SPA know whether a session exists without exposing the credential itself.

Each provider object fields:
- `name` — internal identifier
- `label` — text shown on the sign-in button
- `client_id` — from your IdP app registration
- `client_secret` — optional; omit for PKCE-only / native-app clients
- `discovery_url` — OIDC `.well-known/openid-configuration` URL
- `scopes` — optional; defaults to `["openid","email","profile"]`
- `subject_claim` — optional; defaults to `"sub"`. Use `"oid"` for Azure Entra ID

Register this redirect URI in your IdP: `https://yourdomain.com/auth/callback`

Example with Google and Azure:
```json
[
  {
    "name": "google",
    "label": "Google",
    "client_id": "YOUR_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_SECRET",
    "discovery_url": "https://accounts.google.com/.well-known/openid-configuration"
  },
  {
    "name": "azure",
    "label": "Contoso Azure AD",
    "client_id": "YOUR_AZURE_CLIENT_ID",
    "discovery_url": "https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0/.well-known/openid-configuration",
    "subject_claim": "oid"
  }
]
```

## Email providers

| Provider | Env vars needed |
|----------|----------------|
| `resend` (default) | `RESEND_API_KEY`, `RESEND_FROM` |
| `smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |

Set `EMAIL_PROVIDER=smtp` to switch.

## Multi-app Caddy hosting

All deployments use a shared Caddy reverse proxy by default — there is no single-app mode. `docker-compose.yml` always joins the shared `proxy` Docker network. `infra/docker-compose.infra.yml` manages the shared Caddy instance.

The deploy script handles everything automatically on every push to `main`:
- Creates the `proxy` Docker network if it doesn't exist
- Force-recreates the Caddy container from `infra/docker-compose.infra.yml` with current env vars (including `ACME_EMAIL` and `TRUSTED_PROXY_IPS`)
- Each app writes a `caddy/app.caddy` snippet to the shared `caddy_config` volume and reloads Caddy

No `DEPLOY_MODE` variable or manual SSH steps are needed. The `caddy/app.caddy` snippet uses `{$DOMAIN}` from the environment and proxies to the app container on the shared `proxy` network.
