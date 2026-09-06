# AI Connector — two-way API access for ChatGPT and Claude

Status: **proposal, not built.** This document is the design and the build order.

Decisions taken (Rahul, this round):
- **Read-only first.** Get it working, then decide about writes.
- **Everyone.** This is a user-facing feature, not an admin toy.
- **No special handling for share prices.** A user sending their own figures to
  their own assistant is their business, and people already do it. Prices flow
  through the connector like any other field.
- **Own account only for now**, but the design must extend to shared accounts
  without a rewrite. §8 is how.

## 1. The idea

Let a user point their own AI assistant at their own Epic Stocks account, so they
can ask "what vests before March and what's the tax if I sell it" in ChatGPT
alongside their brokerage data, or have Claude reason about their vesting
schedule next to the rest of their finances.

Read now, write later, one connection, opt-in, revocable.

## 2. Decision: one remote MCP server, protected by our own OAuth 2.1

Build a Model Context Protocol server at `https://<domain>/mcp`, Streamable HTTP
transport, and make the app its own OAuth 2.1 authorization server so the
connector is authorized with a normal sign-in and consent screen — no pasted
credentials.

That single endpoint is reachable by both targets, and by everything else that
speaks MCP (Claude Code, Cursor, and whatever ships next year). §3 covers what
connecting actually looks like for a user.

### Why not the alternatives

- **Custom GPT Actions (OpenAPI + OAuth).** ChatGPT only, and the user has to
  build a GPT. It needs the *same* OAuth server as MCP, and FastAPI already
  emits an OpenAPI document — so once §5 is done it is nearly free. Keep it as a
  documented bonus path, not the primary one.
- **Personal access tokens.** Simpler, and works with local stdio shims. But
  neither ChatGPT nor Claude accepts one for a custom connector, and a
  long-lived bearer token for a financial account is a credential a user will
  eventually paste somewhere public. Skipped unless someone asks for local-shim
  access.
- **Reusing the existing session JWT as the connector credential.** Actively
  dangerous — see §6.2. Rejected.

## 3. What connecting actually costs a user

### Claude — easy

Settings → Connectors → **Add custom connector** → paste
`https://<domain>/mcp` → sign in and approve. Done, about 30 seconds. No
developer mode, no toggles, works on Claude web, desktop and mobile. Available
on Pro, Max, Team and Enterprise. On Team/Enterprise an Owner adds the connector
once and members enable it individually.

Dynamic client registration is what makes mobile work, which is why §6.1 has it.

### ChatGPT — a one-time hurdle, then easy

1. Be on a paid plan — Plus, Pro, Business, Enterprise or Edu. **Web only**;
   custom connectors are not addable from the mobile app.
2. Settings → **Security and login** → turn on **Developer mode**.
3. Plugins → **+** → give it a name and description → paste
   `https://<domain>/mcp` as a public HTTPS endpoint.
4. Sign in through our OAuth screen and approve.
5. Review the discovered tools and create the connection.

Then, in a conversation, pick it from the composer's Developer mode tool or
name it explicitly. ChatGPT is noticeably better when asked to use the connector
by name rather than left to guess.

Two frictions worth naming honestly:

- **"Developer mode" sits under "Security and login".** It is a two-minute,
  one-time step, but for a non-technical colleague it *reads* like something
  you're not supposed to touch. The Connections page (§9) has to walk them
  through it with screenshots and say plainly that it is normal and safe.
- **A Business/Enterprise workspace admin must enable developer mode for the
  workspace.** A colleague whose ChatGPT is provisioned by their employer may
  simply not be able to connect. They can use a personal Plus account instead.

### Would publishing to the ChatGPT app directory fix this?

**For the user experience: yes, materially.** Directory apps install without
developer mode, are discoverable, and are invoked by `@name`. That removes the
whole hurdle above.

**For us: no, and I don't recommend it.** The submission bar is real:

- Identity verification of an individual or organisation on the OpenAI platform
  dashboard, plus published support contact details.
- A published privacy policy covering data categories, purposes, recipients,
  retention and user controls. We have `PRIVACY.md`; it would need review
  against that checklist.
- Human review with automated policy checks. One version under review at a time.
  Published listings use a reviewed **metadata snapshot** — changing tool names
  or descriptions means re-scanning, resubmitting and republishing. That is
  standing overhead on a project that currently ships whenever.
- Screenshots of the app working inside ChatGPT, captured in developer mode.

And three specific problems for *this* app:

1. **The directory is a public storefront.** An app that does nothing unless you
   already hold an account on one private instance is a weak fit for it, and
   "serves a clear purpose for common user intents" is an explicit review
   criterion.
2. **Financial-adjacent categories draw scrutiny.** Unregulated financial
   services are on the prohibited list. An equity tracker is not a financial
   service, but it is close enough to earn a careful reviewer.
3. **The name.** The README already says *Epic Stocks (Unofficial)*. A publicly
   listed OpenAI directory app named after Epic, handling Epic equity, built by
   an Epic employee but unaffiliated with the company, is exactly the artefact
   that gets a legal department's attention. Review policy also requires
   original IP and no impersonation. This is a question to settle with Epic
   before it is a question to settle with OpenAI.

**Recommendation:** ship the custom connector, invest in the Connections page
instructions, and leave the directory alone. Claude users get a genuinely easy
path today; ChatGPT users get two minutes of one-time setup. Revisit only if
real users ask for it *and* the naming question is resolved.

## 4. Where the code goes

```
backend/scaffold/oauth/              # authorization server — reusable, not Epic-specific
    __init__.py
    models.py                        # OAuthClient, OAuthGrant, OAuthAuthCode
    metadata.py                      # RFC 9728 + RFC 8414 well-known documents
    register.py                      # RFC 7591 dynamic client registration
    authorize.py                     # GET/POST /oauth/authorize + consent
    token.py                         # POST /oauth/token, /oauth/revoke
    tokens.py                        # mint/verify connector access tokens
backend/app/mcp/                     # the MCP server — knows about grants and loans
    __init__.py
    transport.py                     # JSON-RPC over Streamable HTTP at /mcp
    tools.py                         # registry: schema + handler + annotations
    read_tools.py
    accounts.py                      # resolve_account() — the shared-data seam, §8
    audit.py
frontend/src/scaffold/pages/Connections.tsx
```

`backend/app/core.py` is not touched. Tools call the same service functions the
existing routers call; no event-computation logic is duplicated.

## 5. The tool surface (read-only)

Action-oriented and narrow, per OpenAI's guidance — `list_grants`, not
`query_data(table=…)`. Every tool carries `readOnlyHint: true`, and every tool
takes the optional `account` parameter described in §8.

| Tool | Backs onto | Scope |
|---|---|---|
| `get_dashboard` | `GET /api/dashboard` | `equity:read` |
| `list_events(from, to, kinds)` | `GET /api/events` — the computed timeline | `equity:read` |
| `list_grants` | `GET /api/grants` | `equity:read` |
| `list_loans` | `GET /api/loans` | `equity:read` |
| `list_sales` | `GET /api/sales` | `equity:read` |
| `list_prices` | `GET /api/prices` | `equity:read` |
| `estimate_sale(shares, date, price)` | `GET /api/sales/estimate` | `equity:read` |
| `get_tax_breakdown(sale_id)` | `GET /api/sales/{id}/tax` | `equity:read` |
| `get_compensation()` | `GET /api/retirement/comp-entries` | `comp:read` |
| `get_retirement_params()` | `GET /api/retirement/params` | `comp:read` |
| `explain(topic)` | `GET /api/content` — vesting rules, grant types | `equity:read` |

`explain` matters more than it looks: without it an assistant guesses at how
Epic's scheme works. With it, it reads the same content the app shows.

**Not exposed, deliberately:** anything under `/api/admin/*`; sharing and
invitations (an assistant must not be able to mail other people); account
deletion and reset; the Epic file importers (acceptance goes through the wizard
by design); push subscriptions.

**Writes are a later phase.** When they come they need preview-before-commit, a
snapshot, an undo and an audit trail — sketched in §11 so today's design does
not paint them into a corner.

**Optional later — `search` and `fetch`.** ChatGPT only treats a connector as a
citable knowledge source if it implements those two standard schemas returning
absolute, user-openable URLs. A follow-up, not a blocker.

## 6. Auth

### 6.1 Endpoints

| Endpoint | Spec | Notes |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 | Names `/mcp` as the resource and this app as its authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 | Advertises endpoints, `S256` PKCE, supported scopes |
| `POST /oauth/register` | RFC 7591 | Dynamic client registration — required for Claude mobile. Anonymous, rate-limited per §6.5 |
| `GET /oauth/authorize` | OAuth 2.1 | Requires an app session; bounces through the existing OIDC login if absent, then renders consent |
| `POST /oauth/authorize` | | The user's Allow/Deny plus scope ticks |
| `POST /oauth/token` | OAuth 2.1 | `authorization_code` + `refresh_token`, PKCE `S256` mandatory |
| `POST /oauth/revoke` | RFC 7009 | |
| `POST /mcp` | MCP 2025-06-18 | 401 carries `WWW-Authenticate: Bearer resource_metadata="…"` |

`GET /mcp` returns 405 — the server initiates no streams, so a plain JSON
response body is enough and SSE is not implemented.

**Registration order matters.** `spa_fallback` is mounted at `/{path:path}` and
returns `index.html` with a 200 for anything unmatched. The well-known routes
and `/mcp` are not under `/api/`, so if they are registered after that mount an
MCP client gets HTML and a baffling error. Include the routers alongside the
others at `main.py:633`, and pin it with a test that fetches
`/.well-known/oauth-protected-resource` and asserts JSON.

### 6.2 Token separation — the part to get right

`scaffold/auth.py:_token_from_request` already accepts `Authorization: Bearer`
for the native shell, and `get_current_user` accepts any JWT this app signed. If
connector tokens come from the existing `create_token`, a stolen connector token
is a full session — admin endpoints included, for an admin account.

So:

- Connector access tokens are JWTs signed with the same `JWT_SECRET` but carry
  `typ: "mcp"`, plus `aud` (the canonical `/mcp` URI), `scope`, and `gid` (the
  grant row id). Lifetime **1 hour**; refresh tokens do the rest.
- `get_current_user` **rejects** any token whose `typ` is not `"session"`.
  Existing session tokens carry no `typ` claim, so absent-or-`"session"` passes —
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

### 6.3 Encryption context

`EncryptionMiddleware` sets the per-user key in the ASGI context by decoding the
bearer token itself (`_token_from_scope`). It will not recognise an MCP token
shape, so without a change every MCP read of an encrypted column raises.
**Teach `_token_from_scope` about `typ: "mcp"` in the same commit as §6.2** —
this is the failure that only appears on a deployment with `KEY_ENCRYPTION_KEY`
set, which means production and not the test suite. Add a test that runs the MCP
path with encryption enabled.

### 6.4 Consent, and the confused-deputy problem

Dynamic client registration lets anyone register a client with any redirect URI.
Mitigations, all of them:

- Consent is **always** shown. No silent re-approval for a dynamically
  registered client, ever.
- The consent screen names the client and shows the **redirect origin** it will
  return to, not just the display name it chose for itself.
- Redirect URIs are matched **exactly** against what was registered, and
  registration is restricted to hosts in `MCP_ALLOWED_REDIRECT_HOSTS` (default:
  `chatgpt.com`, `claude.ai`, `claude.com`, plus `localhost` for development).
  Cheap, and it removes the whole open-redirect class.
- `E2E_TEST=1` must **not** relax any of this. It already skips `redirect_uri`
  validation for the OIDC login flow; the OAuth server needs its own validation
  path the switch does not reach. Test it.

### 6.5 Rate limits and bounds

- `/oauth/register` and `/oauth/token` are anonymous: `check_rate_ip_shared`
  with `client_ip()`, never `check_rate_ip` and never `request.client.host`.
  Sized for a shared office network per the existing budget rule; the 429 names
  the network and carries `Retry-After`.
- `/mcp` is authenticated: `check_rate` on the user id with its own budget, so a
  chatty assistant cannot starve the user's own app session.
- `/mcp` gets an entry in `scaffold/body_limit.py`.
- Row ceilings in `scaffold/quota.py` for `OAuthGrant` (20 connections) and
  `OAuthAuthCode`. Auth codes expire in 60s, are single-use, and the nightly
  maintenance job prunes them.
- `OAuthClient`, `OAuthGrant` and `OAuthAuthCode` all carry `user_id`, so they
  go in `USER_OWNED_TABLES` in `scaffold/user_deletion.py` — the metadata test
  fails the suite until they do.

## 7. Scopes

```
equity:read   grants, loans, sales, prices, events, dashboard, tax
comp:read     salary, bonus, retirement params
```

Both preselected on the consent screen. Reserved for later, advertised in the
metadata document but not yet grantable: `equity:write`, `comp:write`,
`shared:read`.

Consent screen:

> **ChatGPT wants to connect to Epic Stocks**
> returning to `chatgpt.com`
> - [x] Read your equity — grants, vesting, prices, loans, sales, tax estimates
> - [x] Read your salary and retirement settings
>
> It will not be able to change anything.

That last line is true in this phase and is worth saying, because it is the
thing a user is actually nervous about.

## 8. The shared-data seam

Own-account-only today, but built so shared accounts are an additive change
rather than a refactor. Three pieces, all of them in from the start:

1. **Every tool takes an optional `account` parameter**, default `"me"`. It is
   in the published schema from day one, documented as "`me` today; other values
   reserved". A client that omits it keeps working forever.
2. **One resolver.** `backend/app/mcp/accounts.py:resolve_account(user, ref, db)`
   returns the `User` whose rows the tool reads. Today it accepts only `"me"`
   and returns the caller; anything else is a tool error naming the supported
   values. No tool ever touches `user.id` directly — they all go through it.
3. **The hard part is already solved.** Reading someone else's rows needs
   *their* encryption key in context, not the caller's, and
   `sharing.py:_get_shared_owner` already does exactly that: it fetches the
   owner's `encrypted_key` by raw SQL so no TypeDecorator runs with the wrong
   key, calls `set_current_key`, then loads the row. Extending
   `resolve_account` means delegating to that same helper for an invitation
   reference — not inventing anything.

So the future change is: accept `account: "<invitation-id>"` in
`resolve_account`, call `_get_shared_owner`, add the `shared:read` scope to the
consent screen, and add `list_shared_accounts` so the assistant can discover
what it may ask for. No tool signature changes, no token changes, no migration.

## 9. Settings UI — "AI Connections"

New page at `/settings/connections`, linked from Settings. This page is the
feature as far as most users are concerned, so it gets real effort:

- One-paragraph explanation, the server URL with a copy button, and a plain
  statement of what leaves the app and to whom.
- **Two tabbed walkthroughs, ChatGPT and Claude**, matching §3 step for step,
  with screenshots. The ChatGPT one says outright that Developer mode lives
  under "Security and login", that it is normal, that it is web-only, and that a
  work account may need an admin to enable it.
- Connected clients: name, scopes, when connected, last used, **Disconnect**
  (revokes instantly).
- Recent connector activity from the audit table.
- A kill switch: "Turn off AI access" — revokes everything and blocks new
  authorizations until re-enabled.

Mobile-first, Tailwind, matching the existing Settings page. `npx tsc -b
--noEmit` before committing, `./screenshots/run.sh` after.

## 10. Audit

A `mcp_audit` table: timestamp, user, grant id, client name, tool name, scope,
account reference, and outcome. **No amounts, no prices, no share counts** —
same rule as problem reports, and a test asserting on row contents. Shown on the
Connections page as recent activity, and in the admin dashboard as counts only.

This also knocks out the "Audit logging" line in the CLAUDE.md remaining-work
table for the surface where it matters most.

## 11. Build order

**Phase 1 — OAuth 2.1 authorization server. DONE.** Shipped with the transport
and an empty tool registry, so a connector added to ChatGPT or Claude today
connects, authenticates and reports no tools. The `account` parameter and
`resolve_account` seam arrive with the tools in Phase 2.

**Phase 1 as built —** Models + Alembic migration, both
well-knowns, DCR with the redirect allowlist, authorize with consent, token with
PKCE and rotation, revoke. Token type separation (§6.2) and the
`EncryptionMiddleware` change (§6.3) land here.
*Tests:* full authorization-code round trip; PKCE downgrade rejected; redirect
URI mismatch rejected; unregistered redirect host rejected; auth code
single-use and expiring; refresh rotation invalidates the old token; session
token rejected at `/mcp` and MCP token rejected at `/api/grants`; revoke is
immediate; `E2E_TEST=1` does not relax redirect validation; user deletion
removes OAuth rows.

**Phase 2 — MCP transport and the read tools. DONE.** Eleven tools, scope-gated
and listed only where granted; `resolve_account` in from the start so shared
accounts stay additive. `explain` turned out to matter more than expected — it
is what stops an assistant applying ordinary RSU rules to a scheme where
several of them do not hold.

**Phase 2 as built —** JSON-RPC for `initialize`,
`notifications/initialized`, `tools/list`, `tools/call`, `ping`; protocol
version negotiation; the §5 tools; scope enforcement; `resolve_account`.
Hand-roll the JSON-RPC layer rather than adding the `mcp` SDK — it is a small,
fully specified surface and the repo already hand-rolls its JWTs; revisit if the
protocol surface grows.
*Tests:* handshake; `tools/list` matches the registry; each tool against
`fixture.xlsx` data; a tool called without its scope 403s; `account` other than
`"me"` is a clean tool error, not a crash; a malformed JSON-RPC body returns an
error object, never a 500 — the same rule the Epic importers live under, and for
the same reason (unhandled exceptions write `error_logs` rows that push real
tracebacks out of the 500-row window).

**Phase 3 — Connections UI and audit.** The page, the walkthroughs, the kill
switch, the audit table. Vitest, an E2E pass through `./e2e.sh`, screenshots.

**Phase 4 — docs.** README: a "Connecting your own AI" user section, the new env
vars in the table, the new files in the structure section, admin notes.
FORK_GUIDE for the OAuth configuration. Mandatory, not a follow-up.

**Ship after Phase 4.** That is a complete, useful, read-only connector.

**Later, if wanted:**
- Writes: preview-before-commit (`confirm: false` returns a diff and a
  short-lived `change_token`; committing needs a second call), a snapshot before
  the first write of a session reusing the existing `ImportBackup` model and its
  restore path, `undo_last_change`, and the write scopes.
- Shared accounts, per §8.
- `search`/`fetch` for ChatGPT citations.
- A documented Custom GPT Action path off the same OAuth server.

## 12. New environment variables

| Var | Required | Default | Meaning |
|---|---|---|---|
| `MCP_ENABLED` | no | `1` | Deploy-level kill switch. Off, `/mcp` and `/oauth/*` are not registered at all |
| `MCP_ALLOWED_REDIRECT_HOSTS` | no | `chatgpt.com;claude.ai;claude.com` | Semicolon-delimited, matching the `ADMIN_EMAIL` convention |
| `MCP_RATE_LIMIT` | no | `300` | Connector calls per user per minute |
| `MCP_ACCESS_TOKEN_MINUTES` | no | `60` | |

No new secret: the OAuth server signs with the existing `JWT_SECRET`.

## 13. Side finding, unrelated to this feature

`FastAPI(title="Epic Stocks", lifespan=lifespan)` at `main.py:565` passes no
`docs_url`/`openapi_url`, so `/docs`, `/redoc` and `/openapi.json` are public and
enumerate the whole API including every admin endpoint. No data leaks, but it is
free reconnaissance. Suggest `docs_url=None, redoc_url=None, openapi_url=None`
in production. Worth fixing regardless — and note that if the Custom GPT Action
path is ever wanted, it needs a *deliberately* published, narrowed OpenAPI
document rather than the full one.
