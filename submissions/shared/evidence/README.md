# Testing and deployment evidence

Verified 2026-11-25. This file is updated with final PR/check results before
handoff. Local tests do not establish production deployment or host rendering.

| Layer | Evidence/status |
|---|---|
| Existing OAuth/deletion/staging regression | 100 passed, 1 skipped in first targeted run |
| New reviewer tests | Cover production-shaped OAuth, persistent writes, independent datasets/keys, rotation, expiration, revoke/delete/reset, old sessions, cross-account/admin refusal, human approval, shared rate limits, stale calls, Unicode input and public-page recovery |
| Full backend initial run | 2320 passed, 20 skipped; two expected admin tool allowlist assertions needed updating for the added tool. Follow-up targeted run passed 143, skipped 3; subsequent full run: **2329 passed, 20 skipped**; final auth-counter/deletion-race tests also passed |
| Frontend initial run | TypeScript passed; 59 files / 822 tests passed; all 822 passed again; subsequent focused 55 passed |
| Security scans | pip-audit direct requirements: no known vulnerabilities. npm audit --omit=dev: zero vulnerabilities |
| Independent review | Separate assistant security review found login/rotation and stale-grant races, expired-cookie recovery, approval clarity and nested-lock issues; fixes/regression tests added. PR #747 current-head re-review/CI pending after the automated Claude journal-eviction finding was fixed with separate bounded counters |
| Screenshots | Required ./screenshots/run.sh running with temporary backend port 8100. Initial fixed-port screenshot tests revealed hardcoded 8000 references; tests now honor the runner's proxy origin. 27 focused captures passed, then 7 final form/privacy captures passed. New screenshot-only cases now skip outside the capture workflow (111 skipped in CI-shaped validation). |
| E2E | Required ./e2e.sh workflow with local runner fallback prepared; 41 local reviewer/widget/resource cases passed; subsequent reviewer auth-counter flow passed |
| Public endpoints | [Read-only production/staging probes](public-probes.json); OAuth/setup public, privacy 403 for audit client. No real data inspected |
| PostgreSQL concurrency | A temporary PostgreSQL 16 container was used: **22 SQLite/PostgreSQL lock/concurrent-write cases passed**, including independent simultaneous reviewer financial writes. This remains separate from deployment/host acceptance |
| Staging | No claim of deployed new reviewer validation yet; feature PR/review/CI/staging deployment must complete |
| Production | Not deployed or approved by this agent. No production reviewer credentials provisioned. Owner approval remains required |
| ChatGPT/Claude rendering | No actual-host rendering observed in this session. Website/local simulated-host tests are separate evidence |

Production-safe checks were limited to unauthenticated documentation/discovery
requests and Cloudflare rule inspection. No user financial records or documents
were queried, changed or copied into evidence.

A staging-only deployment acceptance module now exercises public HTTPS login, OAuth,
financial reads/confirmed writes, admin refusal, revocation and cleanup using only
its own temporary fictional identities. Unit integration uses the real ASGI routes
through an HTTP transport adapter (4 passed); that is not deployed staging evidence.
The workflow gate is pending review/deployment. GitHub notification subscription
was attempted but the integration token lacks updateSubscription permission; check
watching is used in-session instead.
