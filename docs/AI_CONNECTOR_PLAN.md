# AI Connector — two-way API access for ChatGPT and Claude

Status: **proposal, not built.** This document is the design and the build order.
Nothing in it ships until the open questions at the end are answered.

## 1. The idea

Let a user point their own AI assistant at their own Epic Stocks account, so they
can ask "what vests before March and what's the tax if I sell it" in ChatGPT
alongside their brokerage data, and say "my salary went up to X in 2027" and have
it land in the Total Comp Calculator without opening the app.

Read *and* write, one connection, opt-in, revocable, and off by default.

## 2. Decision: one remote MCP server, protected by our own OAuth 2.1

Build a Model Context Protocol server at `https://<domain>/mcp`, Streamable HTTP
transport, and make the app its own OAuth 2.1 authorization server so the
connector can be authorized without the user ever pasting a credential.

That single endpoint is reachable by **both** targets:

| Client | How the user connects | Requires |
|---|---|---|
| ChatGPT (Plus/Pro/Business) | Settings → Apps → Advanced → Developer mode, then "Add custom connector", paste the URL | Public HTTPS, Streamable HTTP or SSE, OAuth or none |
| Claude (Pro/Max/Team/Enterprise) | Settings → Connectors → "Add custom connector", paste the URL | Public HTTPS, remote MCP, OAuth 2.1; Dynamic Client Registration needed for mobile |
| Claude Code / Desktop, Cursor, others | `claude mcp add --transport http ...` | Same |

The app is already deployed at a public HTTPS domain behind Caddy, so the
hosting precondition is met with no infrastructure change.

### Why not the alternatives

- **Custom GPT Actions (OpenAPI + OAuth).** ChatGPT only, and the user has to
  build a GPT. But it needs the *same* OAuth server as MCP, and FastAPI already
  emits an OpenAPI document — so once §5 is done this is nearly free. Keep it as
  a documented bonus path, not the primary one.
- **Personal access tokens.** Far simpler, and works with local stdio shims. But
  a long-lived bearer token for a financial account, pasted into a chat client,
  is a credential the user will eventually leak, and neither ChatGPT nor Claude
  web accepts one for a custom connector anyway. Skipped. Revisit only if a
  user asks for local-shim access.
- **Reusing the existing session JWT as the connector credential.** Actively
  dangerous — see §5.2. Rejected.

## 3. Threat model, and the three rules this feature lives under

Connecting sends this user's equity data to OpenAI or Anthropic. That is the
user's decision to make, but the app has to make it an *informed* one and keep
the blast radius small.

1. **A connector token is not a session token.** It must never be usable against
   `/api/*`, and a session cookie or session JWT must never be usable against
   `/mcp`. Enforced in both directions, with a test for each. This is the single
   highest-risk part of the build.
2. **Epic share prices leave the building only on an explicit tick.** Per-share
   dollar values are confidential Epic financial data. The consent screen gets a
   separate, default-off checkbox: *"Include Epic share prices. This sends
   confidential company figures to <provider>."* Unticked, price-bearing fields
   are redacted from every tool result — share counts, dates, vesting and loan
   balances still flow, so the connector stays useful.
3. **Every write is previewed, snapshotted, and undoable.** Models
   mis-transcribe numbers. §7.

## 4. Where the code goes

```
backend/scaffold/oauth/              # the authorization server (scaffold: reusable, not Epic-specific)
    __init__.py
    models.py                        # OAuthClient, OAuthGrant, OAuthAuthCode
    metadata.py                      # RFC 9728 + RFC 8414 well-known documents
    register.py                      # RFC 7591 dynamic client registration
    authorize.py                     # GET/POST /oauth/authorize + consent
    token.py                         # POST /oauth/token, /oauth/revoke
    tokens.py                        # mint/verify connector access tokens
backend/app/mcp/                     # the MCP server (app: knows about grants and loans)
    __init__.py
    transport.py                     # JSON-RPC over Streamable HTTP at /mcp
    tools.py                         # tool registry: schema + handler + annotations
    read_tools.py
    write_tools.py
    redact.py                        # price redaction when the scope is absent
    audit.py
frontend/src/scaffold/pages/Connections.tsx    # consent screen + manage connections
```

`backend/app/core.py` is not touched. Tools call the same service functions the
existing routers call; no event-computation logic is duplicated.

## 5. Auth

### 5.1 Endpoints

| Endpoint | Spec | Notes |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 | Names `/mcp` as the resource and this app as its authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | Advertises endpoints, `S256` PKCE, supported scopes |
| `POST /oauth/register` | RFC 7591 | Dynamic client registration. Anonymous — rate-limited per §5.5 |
| `GET /oauth/authorize` | OAuth 2.1 | Requires an app session; bounces through the existing OIDC login if absent, then renders consent |
| `POST /oauth/authorize` | | The user's Allow/Deny plus the scope ticks |
| `POST /oauth/token` | OAuth 2.1 | `authorization_code` + `refresh_token`, PKCE `S256` mandatory |
| `POST /oauth/revoke` | RFC 7009 | |
| `POST /mcp` | MCP 2025-06-18 | 401 carries `WWW-Authenticate: Bearer resource_metadata="…"` |

`GET /mcp` returns 405 — the server initiates no streams, so a plain JSON
response body is enough and SSE is not implemented.

**Registration order matters.** `spa_fallback` is mounted at `/{path:path}` and
returns `index.html` with a 200 for anything unmatched. The well-known routes
and `/mcp` are not under `/api/`, so if they are registered after the mount an
MCP client gets HTML and a baffling error. Include the routers alongside the
others at `main.py:633`, and pin it with a test that fetches
`/.well-known/oauth-protected-resource` and asserts JSON.

### 5.2 Token separation — the part to get right

`scaffold/auth.py:_token_from_request` already accepts `Authorization: Bearer`
for the native shell, and `get_current_user` accepts any JWT this app signed. If
connector tokens are minted by the existing `create_token`, then a stolen
connector token is a full session, including `/api/admin/*` for an admin
account.

So:

- Connector access tokens are JWTs signed with the same `JWT_SECRET` but carry
  `typ: "mcp"`, plus `aud` (the canonical `/mcp` URI), `scope`, and `gid` (the
  grant row id). Lifetime **1 hour**; refresh tokens do the rest.
- `get_current_user` **rejects** any token whose `typ` is not `"session"`.
  Existing session tokens have no `typ` claim, so absent-or-`"session"` passes —
  no migration, no forced re-login.
- The MCP dependency rejects any token whose `typ` is not `"mcp"`, validates
  `aud` against this server's canonical URI (RFC 8707 audience binding), and
  loads `gid` to confirm the grant still exists and is not revoked. That DB hit
  per request is deliberate: it makes revoke instant.
- `session_version` is carried and checked, so "sign out everywhere" kills
  connectors too.
- Refresh tokens are stored as HMAC verifiers, never as secrets, reusing the
  `scaffold/invite_tokens.py` pattern. Refresh rotates on every use.

Two tests, both required: a session token 401s at `/mcp`; an MCP token 401s at
`/api/grants`.

### 5.3 Encryption context

`EncryptionMiddleware` sets the per-user key in the ASGI context by decoding the
bearer token itself (`_token_from_scope`). It will not recognise an MCP token
shape, so without a change every MCP read of an encrypted column raises and
every write raises `EncryptionKeyMissing`. **Teach `_token_from_scope` about
`typ: "mcp"` in the same commit as §5.2** — this is the failure that only shows
up on a deployment with `KEY_ENCRYPTION_KEY` set, i.e. production and not the
test suite. Add a test that runs the MCP path with encryption enabled.

### 5.4 Consent, and the confused-deputy problem

Dynamic client registration lets anyone register a client with any redirect URI.
Mitigations, all of them:

- Consent is **always** shown. No silent re-approval for a dynamically
  registered client, ever.
- The consent screen names the client and shows the **redirect origin** it will
  return to, not just the display name it chose for itself.
- Redirect URIs are matched **exactly** against what was registered, and the
  registration itself is restricted to hosts in `MCP_ALLOWED_REDIRECT_HOSTS`
  (default: `chatgpt.com`, `claude.ai`, `claude.com`, plus `localhost` for
  development). This app has a small, known audience; an allowlist costs
  nothing and removes the whole open-redirect class.
- `E2E_TEST=1` must **not** relax any of this. It already skips `redirect_uri`
  validation for the OIDC login flow; the OAuth server needs its own validation
  path that the switch does not reach. Test it.

### 5.5 Rate limits

- `/oauth/register` and `/oauth/token` are anonymous: `check_rate_ip_shared`
  with `client_ip()`, never `check_rate_ip` and never `request.client.host`.
  Sized for a shared office network per the existing budget rule, and the 429
  names the network and carries `Retry-After`.
- `/mcp` is authenticated: `check_rate` on the user id, with its own budget
  separate from `MUTATION_RATE_LIMIT` so a chatty assistant cannot starve the
  user's own app session. Suggest `MCP_RATE_LIMIT` (default 300/min read,
  writes additionally counted against the existing mutation limiter).
- `/mcp` gets an entry in `scaffold/body_limit.py`.
- A row ceiling in `scaffold/quota.py` for `OAuthGrant` (say 20 connections) and
  `OAuthAuthCode`, per the bounded-fields rule. Auth codes expire in 60s and are
  single-use; the nightly maintenance job prunes them.

## 6. The tool surface

Action-oriented and narrow, per OpenAI's guidance — `list_grants`, not
`query_data(table=…)`. Every read tool carries `readOnlyHint: true`; every write
tool carries `destructiveHint` honestly.

**Read** (scope `equity:read` unless noted)

| Tool | Backs onto |
|---|---|
| `get_dashboard` | `GET /api/dashboard` |
| `list_events(from, to, kinds)` | `GET /api/events` — the computed timeline |
| `list_grants`, `list_loans`, `list_sales` | the respective routers |
| `list_prices` | `GET /api/prices` — **`prices:read` only** |
| `estimate_sale(shares, date, price)` | `GET /api/sales/estimate` |
| `get_tax_breakdown(sale_id)` | `GET /api/sales/{id}/tax` |
| `get_compensation()` | `GET /api/retirement/comp-entries` — `comp:read` |
| `get_retirement_params()` | `GET /api/retirement/params` — `comp:read` |
| `explain(topic)` | `GET /api/content` — vesting rules, grant types, so the assistant reasons about Epic's actual scheme instead of guessing |

**Write** (each takes `confirm: bool = false`; see §7)

| Tool | Scope |
|---|---|
| `add_grant`, `update_grant`, `delete_grant` | `equity:write` |
| `add_price`, `update_price` | `prices:write` |
| `add_loan`, `record_loan_payment` | `equity:write` |
| `record_sale` | `equity:write` |
| `set_compensation(year, salary, bonus, …)` | `comp:write` |
| `set_retirement_params(…)` | `comp:write` |
| `undo_last_change()` | whichever write scope is held |

**Not exposed, deliberately:** anything under `/api/admin/*`, sharing and
invitations (an assistant should not be able to mail other people), account
deletion and reset, the Epic file importers (they are a wizard, and acceptance
goes through the wizard by design), push subscriptions.

**Optional later — `search` and `fetch`.** ChatGPT only treats a connector as a
citable knowledge source if it implements those two standard schemas returning
absolute user-openable URLs. Worth doing in a follow-up so answers cite back
into the app; not needed to make the connector work.

## 7. Write safety

Three layers, all server-side, because a client-side "are you sure" is the
model's to skip:

1. **Preview by default.** A write tool called with `confirm: false` (the
   default) commits nothing and returns a rendered diff plus a `change_token`.
   Committing requires a second call with `confirm: true` and that token, which
   expires in 5 minutes. The assistant therefore has to show the user the diff
   before it can act, in every client, with no reliance on client behaviour.
2. **Snapshot before the first write of a connection-day**, reusing the existing
   `ImportBackup` model — it already stores an encrypted JSON snapshot of
   grants, prices and loans and already has a restore endpoint. `undo_last_change`
   restores it. No new backup machinery.
3. **Audit.** A new `mcp_audit` table: timestamp, user, grant id, client name,
   tool name, scope, affected row ids, and outcome. **No amounts, no prices, no
   share counts** — same rule as problem reports, for the same reason. Surfaced
   on the Connections page as "last 50 actions" and in the admin dashboard as
   counts only. This also knocks out the "Audit logging" line in the CLAUDE.md
   remaining-work table for the surface where it matters most.

Cache invalidation goes through `schedule_recompute` exactly as the routers do —
no new threading.

## 8. Scopes

```
equity:read   grants, loans, sales, events, dashboard, tax
equity:write  create/update/delete the above
prices:read   per-share dollar values          ← default OFF, warned
prices:write  entering prices
comp:read     salary, bonus, retirement params ← default OFF
comp:write
```

Consent screen presents them as four plain-English ticks, read-only preselected:

> **ChatGPT wants to connect to Epic Stocks**
> returning to `chatgpt.com`
> - [x] Read your equity — grants, vesting, loans, sales, tax estimates
> - [ ] Make changes — add grants, record sales, enter loan payments
> - [ ] Read and write Epic share prices — *these are confidential Epic figures and will be sent to OpenAI*
> - [ ] Read and write your salary and retirement settings

With `prices:read` withheld, `redact.py` strips per-share values from every
result and substitutes `null` with a `"redacted": "prices"` marker so the
assistant explains the gap rather than inventing a number.

## 9. Settings UI — "AI Connections"

New page at `/settings/connections`, linked from Settings:

- One-paragraph explanation, the server URL with a copy button, and
  step-by-step instructions for ChatGPT and for Claude (including that ChatGPT
  needs developer mode enabled and a paid plan).
- A clear statement of what leaves the app and to whom.
- The list of connected clients: name, scopes, when connected, last used, and a
  **Disconnect** button that revokes instantly.
- Recent connector activity from `mcp_audit`.
- A global kill switch: "Turn off AI access" — revokes everything and blocks new
  authorizations until re-enabled.

Mobile-first, Tailwind, matching the existing Settings page. Screenshots via
`./screenshots/run.sh` after, per the UI checklist.

## 10. Build order

Each phase is independently shippable and gated on its own tests.

**Phase 1 — OAuth 2.1 authorization server.** Models + migration, both
well-knowns, DCR with the redirect allowlist, authorize with consent, token with
PKCE and rotation, revoke. Token type separation (§5.2) and the
`EncryptionMiddleware` change (§5.3) land here.
*Tests:* full authorization-code round trip; PKCE downgrade rejected; redirect
URI mismatch rejected; unregistered redirect host rejected; auth code
single-use and expiring; refresh rotation invalidates the old token; session
token rejected at `/mcp` and MCP token rejected at `/api/grants`; revoke is
immediate; `E2E_TEST=1` does not relax redirect validation.

**Phase 2 — MCP transport and read tools.** JSON-RPC handling for `initialize`,
`notifications/initialized`, `tools/list`, `tools/call`, `ping`; protocol
version negotiation; the read tools; scope enforcement; price redaction.
Hand-roll the JSON-RPC layer rather than adding the `mcp` SDK — it is a small,
fully specified surface and the repo already hand-rolls its JWTs; revisit if the
protocol surface grows.
*Tests:* handshake; `tools/list` matches the registry; each tool against
`fixture.xlsx` data; a tool called without its scope 403s; prices redacted
without `prices:read`; a malformed JSON-RPC body is an error object, never a
500 — the same rule the Epic importers live under, and for the same reason
(unhandled exceptions write `error_logs` rows that push real tracebacks out).
**Ship here.** This alone is a working read-only connector in both products.

**Phase 3 — write tools.** Confirm/preview, `change_token`, snapshot, undo,
audit table, quotas.
*Tests:* `confirm: false` mutates nothing; a stale or reused `change_token` is
rejected; each write path; undo restores; audit rows carry no financial values
(assert on the row contents).

**Phase 4 — Connections UI.** The page, the kill switch, the consent screen
styling. Vitest + an E2E run through `./e2e.sh`, plus `npx tsc -b --noEmit`
before committing and `./screenshots/run.sh` after.

**Phase 5 — docs.** README: a "Connecting your own AI" user section, the new env
vars in the table, the new files in the structure section, the new admin notes.
FORK_GUIDE for the OAuth configuration. This is mandatory, not a follow-up.

**Optional Phase 6.** `search`/`fetch` for ChatGPT citations; a documented
Custom GPT Action path off the same OAuth server.

## 11. New environment variables

| Var | Required | Default | Meaning |
|---|---|---|---|
| `MCP_ENABLED` | no | `0` | Master switch. Off, `/mcp` and `/oauth/*` are not registered at all |
| `MCP_ALLOWED_REDIRECT_HOSTS` | no | `chatgpt.com;claude.ai;claude.com` | Semicolon-delimited, matching the `ADMIN_EMAIL` convention |
| `MCP_RATE_LIMIT` | no | `300` | Connector calls per user per minute |
| `MCP_ACCESS_TOKEN_MINUTES` | no | `60` | |

No new secret: the OAuth server signs with the existing `JWT_SECRET`.

## 12. Side finding, unrelated to this feature

`FastAPI(title="Epic Stocks", lifespan=lifespan)` at `main.py:565` passes no
`docs_url`/`openapi_url`, so `/docs`, `/redoc` and `/openapi.json` are public and
enumerate the whole API including every admin endpoint. No data leaks, but it is
free reconnaissance. Suggest `docs_url=None, redoc_url=None, openapi_url=None`
in production and gated on `E2E_TEST` or an admin session otherwise. Worth
fixing regardless of whether this feature is built — and note that if the Custom
GPT Action path in Phase 6 is ever wanted, it needs a *deliberately* published,
narrowed OpenAPI document rather than the full one.

## 13. Open questions

1. **Prices:** is the default-off tick with an explicit warning the right call,
   or should per-share values be withheld from connectors outright?
2. **Writes:** ship Phase 3 at all, or stop at read-only? Read-only removes most
   of the risk and probably delivers most of the value.
3. **Who gets it:** everyone, or admin-enabled per account while it settles?
   `MCP_ENABLED` as specified is global; a per-user flag is a small addition.
4. **Shared data:** should a connector see accounts shared *with* the user
   (`/api/sharing/view/*`), or only their own? Own-only is the safe default and
   what this plan assumes.
5. **Scope of build:** all five phases, or Phases 1–2 first and decide after
   using it?
