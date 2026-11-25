# Directory reviewer identities

Dedicated `directory-reviewer` identities are synthetic `users` rows with a
`reviewer_accounts` binding, not ordinary OIDC users. Login checks all three:
provider/namespace, synthetic marker, and a live unexpired binding. Synthetic
staging workspace users remain unauthenticated. No existing user can be selected
or converted by provisioning arguments. Both admin flags must remain false.

Fixture seeding reuses `app.mcp.test_account_tools._seed` and `app.demo` profiles.
`services.reviewer_fixtures` receives this application provider from `main.py`,
keeping authentication independent of the financial implementation. An account
owns one persistent dataset and an independent user encryption key across all
of its OAuth clients and browser sessions. Provision another account when tests
need independent mutable state. OpenAI and Anthropic never share identities.

Reviewer passwords are 48 random bytes encoded URL-safe; storage contains only a
domain-separated keyed HMAC verifier. The generated secret appears once in the
admin browser response or admin MCP request result. Never log or commit it.
The reviewer login uses a separate CSRF-protected HTML form, HttpOnly secure
session cookie, IP/network flood protection and per-login shared rate limiting.
Authentication attempts use separate atomic daily counters for attempt/success/failure,
with all unknown usernames sharing one bucket per day/outcome. Counters expire after
90 days and cannot evict the management journal. Admin MCP listing includes the
last seven days of counts per reviewer. No supplied username, password or IP is
stored in these counters. Redis makes limits shared across replicas; its existing in-process fallback
is weaker during Redis outages and deploys. Operations should monitor Redis.

The ordinary OAuth discovery, DCR, S256 PKCE, explicit scope consent, resource
binding, access/rotating refresh credentials and revocation machinery is reused.
Expiry, revocation, synthetic namespace and privilege flags are checked at every
session and MCP authorization boundary. Rotation increments session version,
erases authorization codes and grants. Token exchange and dataset operations
serialize with management using the existing cross-worker account locks.

Browser admin access grants immediately as a human action. Admin MCP provisioning,
rotation and extension file `reviewer_access` in the existing approval queue.
The generated password is inactive until browser or one-time push-code approval;
only its verifier enters that request. No password appears in request history
or the administrator journal. Reset/revoke/delete require a bound preview token.
Reset preserves access but changes dataset generation and invalidates financial
previews. Rotation/extension invalidates sessions and connections. Expiration
preserves data; it does not silently reset it. Automatic staging cleanup excludes
reviewer bindings. Deletion uses the single user-deletion service.

Reviewer HTTP sessions cannot use admin/content writes, sharing/invitations,
notifications, onboarding analytics or authentication
provider changes. MCP resolves only `account: me`. Company share prices are
never seeded or fetched; fixtures use invented round numbers. Reviewer accounts
have no admin or content-admin permissions, even if their address is mistakenly
added to `ADMIN_EMAIL`.

## Operations

Open Admin → Directory reviewer accounts. Choose platform, scenario, and 1–90
days. Provision, save the displayed login/password securely, then hide it.
Use **Load reviewers** for status. **Rotate / extend** generates a fresh password
and invalidates existing sessions/connections. Reset/revoke/delete first display
a confirmation. Never reset a live evaluation without coordinating with it.
Use an established account for general review; provision an independent empty
account for onboarding/import tests, and separate additional established accounts
for concurrent independent evaluations. Maximum 40 reviewer accounts.

Admin MCP: `admin_list_reviewers`, `admin_request_reviewer_access`,
`admin_reset_reviewer`, `admin_revoke_reviewer`, `admin_delete_reviewer`.
For rotation/extension pass the existing `reviewer_id`, matching platform and
scenario, and the new days to `admin_request_reviewer_access`. Approve through
Admin → AI Connections or the existing `admin_approve_request` push-code flow.
Activity is available through existing connection/audit and admin journal tools;
no financial values should be included in review administration.

Sign-in URL: `/reviewer-login`. To authenticate a connector, start its ordinary
OAuth flow, choose **Directory reviewer sign-in** on the login page, enter the
provided credentials, then approve consent. Alternatively sign in to that URL
first in the same browser and begin connecting. No Google account, email,
SMS, MFA, or dataset setup is required.

## Deployment

Alembic revision `x5y6z7a8b9c0` adds only the reviewer binding table. No credentials
or reviewer users are created by migration, startup or deployment. There are no
new production secrets or environment switches. Provision production accounts
only after approved deployment; test production discovery without real data.
Production validation is not implied by passing local/staging tests.


The admin MCP returns each newly generated reviewer password in its private tool
result so the administrator can supply it to a reviewer without a separate
browser retrieval step. The assistant provider's conversation/log retention
therefore applies to that credential (up to the selected 90-day maximum access
window). The human approval gate still controls activation. Prefer browser-only
provisioning when the credential should not enter an assistant transcript;
rotate/revoke promptly after review and never copy it into public artifacts.

Reviewers can file the ordinary opt-in problem report and sign out everywhere
for their own fictional identity. Sign-out and token refresh serialize with
credential rotation. Public/static requests do not trigger reviewer lookups.
