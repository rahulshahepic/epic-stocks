# Epic Network Deployment Notes

Planning notes for deploying on Epic's internal network. Not yet implemented.
Supersedes some assumptions baked into the current single-user-upload model.

---

## Deployment Context

In the Epic deployment this app becomes a **read + action layer** on top of
Epic's existing equity database. The app does not own the data — it reads from
a source-of-truth DB managed by Epic's systems and exposes a small set of
user-initiated actions back into that system.

### Users

~15,000 employees who hold Epic equity. Auth is Azure Entra ID only (see
`CLAUDE.md` → OIDC_PROVIDERS). The `subject_claim` must be `"oid"` (the
immutable Entra Object ID, not `sub` which is per-app-scoped). User identity
maps to equity data via an employee identifier that Epic's Entra configuration
exposes as a claim — most likely `employeeId` or `onPremisesSamAccountName`.
Confirm the exact claim name with Epic's identity team before building the
auth→data join.

### Database

Epic runs MSSQL (SQL Server). Encryption at rest via Transparent Data
Encryption (TDE) — managed by Epic's DBAs, transparent to the app. The app's
current per-user AES-256-GCM column encryption (`scaffold/crypto.py`,
`KEY_ENCRYPTION_KEY`) becomes unnecessary and should be disabled for this
deployment. The app connects via a read-mostly service account; write-back for
user-initiated actions goes through a separate service account with tightly
scoped permissions.

---

## Data Change Sources (external batch processes)

The app does **not** own writes to the core equity tables. Changes arrive from
Epic's batch systems:

| Event | Affected users | Cache impact |
|---|---|---|
| Annual stock price announcement | All users | Invalidate all → fan-out recompute |
| New purchase grant + purchase loan batch | Affected employees | Invalidate per-user |
| Interest loan processing | Affected employees | Invalidate per-user |
| Batch loan payoff processing | Affected employees | Invalidate per-user |
| Exit event / liquidation | All (or subset) | Invalidate all → fan-out recompute |

Because writes come from outside this app, the current `schedule_recompute` /
`schedule_fan_out` hooks attached to write endpoints will not fire for these
events. A separate invalidation mechanism is required (see below).

---

## Cache Invalidation Strategy (external-DB scenario)

The current Redis cache uses content-addressed keys
(`timeline:{user_id}:{data_hash}`), so stale keys naturally become unreachable
when data changes. The 24h TTL provides a backstop. But for time-sensitive
events like the price announcement we need faster invalidation.

### Options (in order of preference)

**1. Webhook endpoint (recommended)**
Epic's batch process calls `POST /api/internal/cache-invalidate` with a payload
indicating what changed (`{ "scope": "all" }` for price/exit events,
`{ "user_ids": [...] }` for per-employee changes). The endpoint calls
`schedule_fan_out()` or targeted `schedule_recompute(user_id)` as appropriate.
Requires cooperation from Epic's batch team to add the webhook call at the end
of each batch job. Secured via a shared secret or mTLS.

**2. PostgreSQL / MSSQL change notifications**
If the source-of-truth DB is PostgreSQL, `LISTEN/NOTIFY` can trigger
invalidation. MSSQL equivalent is SQL Server Service Broker or Query
Notifications — more complex. Adds a persistent DB connection per app replica.

**3. Short TTL (simplest, eventual consistency)**
Reduce Redis TTL from 24h to something like 5–15 minutes. Equity data changes
infrequently (price once a year, grants/loans a few times a year). A 15-minute
stale window is acceptable for most scenarios. Not acceptable for the price
announcement spike — users would see old values for up to 15 minutes.

**4. Hybrid: short TTL + webhook for price announcements**
Use 15-minute TTL as the baseline. Add the webhook endpoint specifically for
price announcement day, which can be called manually or by batch job. This
covers the spike without requiring full webhook integration for all events.

### Recommendation

Start with option 3 (short TTL, e.g. 15 minutes) during the pilot phase since
it requires no coordination with Epic's batch team. Add the webhook endpoint
(option 1) before general rollout so the price announcement experience is
instant rather than eventually consistent.

---

## User-Initiated Actions

The two actions users can take through this app that write back to Epic's
systems:

### 1. Early Loan Payoff Request

User requests to pay off a specific loan ahead of its due date.

**Mechanics:**
- Triggers a sale of stock to cover the outstanding loan balance
- Lot selection is LIFO by default, **with an Epic-specific override**: skip
  any lots whose cost basis would result in short-term capital gains (STCG) if
  possible — i.e., prefer lots held longer than the LTCG threshold even if LIFO
  order would reach a short-term lot first
- If LTCG lots alone are insufficient to cover the loan, fall back to STCG lots
- The sale amount must cover: loan principal remaining (minus any early cash
  payments already made)
- The gross-up calculation must account for estimated tax on the gain so the
  net proceeds cover the full loan balance

**Difference from current implementation:**
Current `_compute_payoff_sale` in `loans.py` does LIFO/FIFO lot selection
without the "skip STCG if possible" logic. This needs to be added as a new lot
selection mode, e.g. `"epic_lifo"` — LIFO but prefer LTCG lots, skip STCG lots
unless unavoidable.

### 2. Stock Sale Request

User requests to sell shares of a specific tranche (grant year + type).

**Mechanics:**
- A tranche sale **must first cover any outstanding loans associated with that
  tranche** before converting the remainder to cash
- If the tranche has a linked loan: the sale size must be at least large enough
  to pay off that loan (gross-up for tax applies here too)
- Beyond the loan payoff, the user receives cash proceeds minus tax withholding
- If withholding applies: the sale must cover withholding amount + loan payoff;
  the user nets the remainder
- "What if" mode: given a desired net cash amount X, compute how many shares
  must be sold (iterative gross-up: shares → gross proceeds → tax → net → check
  against X → adjust)

**Tranche targeting:**
Current sale model in `sales.py` does not enforce tranche-level lot priority or
mandatory loan coverage. The Epic version needs a sale request that specifies
`grant_year` + `grant_type`, validates the loan coverage requirement, and
computes the correct share count.

---

## Scaling Notes

See conversation history for full analysis. Summary:

- **Redis** (optional, via `REDIS_URL`) provides cross-replica L2 cache. Already
  implemented — see `backend/app/event_cache.py`.
- **Pre-warming** on data changes: `schedule_recompute(user_id)` for single-user
  changes, `schedule_fan_out()` (10-thread pool) for price changes. In the
  external-DB model these are triggered by the webhook endpoint instead of
  write-endpoint hooks.
- **Peak load**: Price announcement day — all 15k users hit the app
  simultaneously. Pre-warm the cache via fan-out before the announcement email
  goes out. Pre-scale K8s replicas the morning of announcement day.
- **Redis memory at 15k users**: ~600MB (JSON) / ~300MB (msgpack). Azure Cache
  for Redis C1 (1GB) is sufficient; C1 Standard for HA.
- **DB read replicas**: fan-out recompute reads grants/loans/prices for all
  users simultaneously — route these reads to a read replica to protect the
  primary.

---

## Remaining Work for Epic Deployment

| Item | Notes |
|---|---|
| Auth: Entra ID claim mapping | Confirm `employeeId` claim name with Epic identity team. Map `oid` as auth anchor, `employeeId` as equity DB join key. |
| Encryption: disable per-user KEK | Remove `KEY_ENCRYPTION_KEY` from Epic deploy config. TDE handles at-rest encryption at the DB level. |
| DB adapter: MSSQL | Replace `psycopg2-binary` with `pyodbc` or `pymssql`. Update `DATABASE_URL` format. SQLAlchemy dialect: `mssql+pyodbc`. |
| Cache invalidation: webhook endpoint | `POST /api/internal/cache-invalidate` with scope payload. Secured via shared secret. |
| Lot selection: `epic_lifo` mode | LIFO but prefer LTCG lots; skip STCG lots unless unavoidable. Add to `sales_engine.py`. |
| Sale action: tranche-targeted | New endpoint that enforces loan coverage before cash conversion. Gross-up for withholding. |
| Sale action: "what if" cash target | Given desired net X, iteratively compute shares needed. Can be purely read (no write) — just runs core.py with hypothetical sale injected. |
| Payoff action: write-back | Actual write to Epic's DB when user confirms a payoff/sale request. Requires write service account + approval workflow TBD. |
| Connection pooling | PgBouncer equivalent for MSSQL (e.g. SQL Server connection pooling via driver). Tune pool size for 1k+ concurrent users. |
| Pre-scale runbook | K8s deployment patch to bump replicas morning of price announcement. GitHub Actions workflow. |
