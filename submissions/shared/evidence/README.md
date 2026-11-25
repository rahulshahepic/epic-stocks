# Testing and deployment evidence

Verified 2026-11-25. Local tests do not establish production deployment or host rendering.

| Layer | Evidence/status |
|---|---|
| Backend | [Final promotion CI evidence](https://github.com/rahulshahepic/epic-stocks/pull/750#issuecomment-7170690471): **2,378 passed, 5 skipped**. [Authentication CI at e190e04](https://github.com/rahulshahepic/epic-stocks/actions/runs/45665838413) passed all required jobs, including full backend/browser suites |
| Reviewer/concurrency | Final focused run: **49 passed, 1 skipped**; additional owned-worker cancellation regression **3 passed**. Covers independent persistent data, key separation, rotation, expiration, revocation, reset, boundaries, approval, pool contention and cancellation |
| Frontend | Merged reporting/reviewer baseline: TypeScript and **824 tests in 59 files passed**. Final screenshot lint formatting fixed; authentication frontend CI passed at e190e04 |
| Security | pip-audit direct requirements including AnyIO4.16.0: no known vulnerabilities; npm audit --omit=dev: zero |
| Independent review | [Authentication PR #747](https://github.com/rahulshahepic/epic-stocks/pull/747). Separate assistant found/followed fixes for lifecycle races, journal eviction, pool contention and cancellation cleanup. [Independent exact-head clearance](https://github.com/rahulshahepic/epic-stocks/pull/747#issuecomment-7169673546); automated Claude review also clear; merged into staging3112916 |
| Screenshots | Required ./screenshots/run.sh: 27 initial focused captures, 7 follow-up captures, 11 merged reporting/reviewer captures, **4 public-privacy and2 support/setup accessibility/mobile captures passed**. Canonical screenshots committed; website/local host evidence distinguished |
| E2E | ./e2e.sh supported local fallback: 41 reviewer/widget/resource cases passed; merged reporting/reviewer/resource3 passed. Real PostgreSQL browser testing reproduced the pool deadlock and verified requests progress after fix; full clean-database authentication CI passed at e190e04. Reusing a populated test DB produces expected empty-account failures and is not counted as passing |
| Public endpoints | [Post-deploy production probes](production-public-probes.json); [historical production/staging probes](public-probes.json). Public health, discovery, reviewer login, support and scriptless privacy are reachable. A 200 SPA shell at /terms does not establish legal publication |
| Cloudflare | Live ruleset **14** verified read-only; managed challenge **6**, Browser Integrity Check exception **3**, both enabled. Exclusions are host-, path- and method-scoped. The ops JSON is historical and must not be replayed |
| Submission follow-up | 216 tools/writes/retirement tests and149 smoke/reviewer/annotation tests passed (overlapping selections). The smoke now tests both real host callback URLs, MCP negotiation, tool visibility/annotations and persistence |
| Staging | [Exact-head staging deployment and acceptance](https://github.com/rahulshahepic/epic-stocks/actions/runs/45671945719) passed on `024f72b`: OAuth, confirmed writes, admin refusal, revocation and cleanup, for both temporary reviewer accounts |
| Production | [#750](https://github.com/rahulshahepic/epic-stocks/pull/750) merged as `451b6ca`; [production deployment](https://github.com/rahulshahepic/epic-stocks/actions/runs/45673166459) completed successfully. This is not production signed-in reviewer or visible host evidence |
| Live connected staging calls | The connected ChatGPT staging tool returned a verified established fictional context, equity summary and unsaved retirement simulation (100 paths, seed1729). An initial32-path call correctly failed validation; schema/range error now disclose the minimum. No record writes or resets were made. These structured tool calls do not establish visible host rendering/callbacks |
| ChatGPT/Claude rendering | No actual-host UI rendering observed. Website/local simulated-host tests and live structured calls do not establish it |
| Supplemental video | Actual fictional website demo recorded1280×800 via required screenshot runner; WebM in public/review. Not a ChatGPT/Claude capture |

Production-safe checks were limited to unauthenticated documentation/discovery
requests and Cloudflare rule inspection. No user financial records or documents
were queried, changed or copied into evidence.

A staging-only deployment acceptance module now exercises public HTTPS login, OAuth,
financial reads/confirmed writes, admin refusal, revocation and cleanup using only
its own temporary fictional identities. Unit integration uses the real ASGI routes
through an HTTP transport adapter (4 passed); that is not deployed staging evidence.
The final passing workflow result is linked above. GitHub notification subscription
was attempted but the integration token lacks updateSubscription permission; check
watching is used in-session instead.
