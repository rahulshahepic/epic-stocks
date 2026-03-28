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

Set `OIDC_PROVIDERS` as a GitHub Secret containing a JSON array. It supports any OIDC-compliant IdP (Google, Azure Entra ID, Okta, etc.). `client_secret` is optional — omit it for PKCE-only / native-app clients. Multiple providers show as separate "Sign in with X" buttons on the login page. No frontend changes needed — the PKCE flow is provider-agnostic.

Example:
```json
[{"name":"google","label":"Google","client_id":"YOUR_ID.apps.googleusercontent.com","client_secret":"YOUR_SECRET","discovery_url":"https://accounts.google.com/.well-known/openid-configuration"}]
```

## Email providers

| Provider | Env vars needed |
|----------|----------------|
| `resend` (default) | `RESEND_API_KEY`, `RESEND_FROM` |
| `smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` |

Set `EMAIL_PROVIDER=smtp` to switch.

## Multi-app Caddy hosting

To run multiple apps on one server with a shared Caddy:

1. On the server, start the shared infra once:
   ```bash
   cd infra
   docker compose -f docker-compose.infra.yml up -d
   ```

2. For each app, set `DEPLOY_MODE=multiapp` in GitHub vars.

3. Deploy normally — the deploy script will write `caddy/app.caddy` to the shared `caddy_config` volume and reload Caddy.

The `caddy/app.caddy` snippet uses `{$DOMAIN}` from the environment and proxies to the `epic-stocks-app` container by name on the shared `proxy` network.
