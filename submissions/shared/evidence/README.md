# Testing and deployment evidence

Verified 2026-11-25. This file is updated with final PR/check results before
handoff. Local tests do not establish production deployment or host rendering.

| Layer | Evidence/status |
|---|---|
| Backend | Before final concurrency fix: **2365 passed, 2 skipped**, including actual PostgreSQL concurrency. [Authentication CI at e190e04](https://github.com/rahulshahepic/epic-stocks/actions/runs/45665838413) passed all required jobs, including full backend/browser suites |
| Reviewer/concurrency | Final focused run: **49 passed, 1 skipped**; additional owned-worker cancellation regression **3 passed**. Covers independent persistent data, key separation, rotation, expiration, revocation, reset, boundaries, approval, pool contention and cancellation |
| Frontend | Merged reporting/reviewer baseline: TypeScript and **824 tests in 59 files passed**. Final screenshot lint formatting fixed; authentication frontend CI passed at e190e04 |
| Security | pip-audit direct requirements including AnyIO4.16.0: no known vulnerabilities; npm audit --omit=dev: zero |
| Independent review | [Authentication PR #747](https://github.com/rahulshahepic/epic-stocks/pull/747). Separate assistant found/followed fixes for lifecycle races, journal eviction, pool contention and cancellation cleanup. [Independent exact-head clearance](https://github.com/rahulshahepic/epic-stocks/pull/747#issuecomment-7169673546); automated review still pending |
| Screenshots | Required ./screenshots/run.sh: 27 initial focused captures, 7 follow-up captures, 11 merged reporting/reviewer captures, **4 public-privacy accessibility/mobile captures passed**. Canonical screenshots committed; website/local host evidence distinguished |
| E2E | ./e2e.sh supported local fallback: 41 reviewer/widget/resource cases passed; merged reporting/reviewer/resource3 passed. Real PostgreSQL browser testing reproduced the pool deadlock and verified requests progress after fix; full clean-database authentication CI passed at e190e04. Reusing a populated test DB produces expected empty-account failures and is not counted as passing |
| Public endpoints | [Actual production/staging probes](public-probes.json). Production reviewer/privacy paths still403 for audit client; staging edge now permits requests. A200 SPA shell is explicitly not treated as policy/login availability |
| Cloudflare | Independently reviewed staging-only exact-path exceptions applied2026-11-25; ruleset12, challenge rule5/BIC rule2. 6,624 request combinations verified non-staging behavior unchanged. Production recipe remains unapplied |
| Submission follow-up | 216 tools/writes/retirement tests and149 smoke/reviewer/annotation tests passed (overlapping selections). The smoke now tests both real host callback URLs, MCP negotiation, tool visibility/annotations and persistence |
| Staging | New deployment acceptance module pending merge/deployment. No claim of deployed reviewer validation yet |
| Production | Not deployed/approved. No production reviewer credentials provisioned; owner approval required |
| ChatGPT/Claude rendering | No actual-host rendering observed. Website/local simulated-host tests do not establish it |
| Supplemental video | Actual fictional website demo recorded1280×800 via required screenshot runner; WebM in public/review. Not a ChatGPT/Claude capture |

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
