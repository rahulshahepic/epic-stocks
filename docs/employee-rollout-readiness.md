# Employee rollout evidence and release gates

Source baseline: `d428120` (2026-11-24). This is an audit record, not a declaration that the service is ready. Never put employee records, real share prices, tokens, keys or document excerpts in this checklist.

## Findings addressed in this PR

The browser privacy notice described retirement inputs and date of birth as plaintext although their ORM types are `EncryptedJSON` and `EncryptedDate`. It also claimed third-party infrastructure could never access financial data. The notices now explain conditional server encryption, operator access, TLS proxy access and backup retention. The Markdown policy and browser notice disclose anonymous request counters, opt-out/DNT and180-day pruning. A deterministic pool-contention regression also exposed event-loop blocking in maintenance/Epic-mode guards; their synchronous reads now run in worker threads so active requests can release connections. This fixes a reproduced starvation mechanism; the original CI timeouts did not include a live thread dump proving their cause.

## Evidence register

| Area | Source and automated evidence | Live evidence / owner | Status and severity |
|---|---|---|---|
| Trial file lifetime | `app/routers/trial.py`, `_read_upload` and `_parse_files`; source does not save uploads; `test_trial.py`, `test_upload_hardening.py` | Operator: inspect proxy/body buffering and access/error-log configuration using synthetic files; record temp-file cleanup after success, error and process termination | Source checked; live unverified, launch blocker |
| PDF concurrency | `epic_import/pdf_statement.py`: text budget and bounded parse slots, overload sheds with 503; adversarial tests in `test_upload_hardening.py` | Operator: concurrent synthetic imports at campus-scale traffic, record latency/RSS/error rate | Bounds tested; deployment capacity unverified, launch blocker |
| XLSX expansion | `scaffold/safe_workbook.py`: limits archive members and expanded size before parsing | Operator: exercise refusal on deployed staging | Unit evidence available; deployment unverified |
| Encryption / privileged access | `scaffold/crypto.py`, `scaffold/models.py`; fail-closed key context tests in `test_crypto.py` | Operator: confirm configured KEK, storage permissions, key backup and authorized host users without posting secrets | Application support tested; live configuration unverified, launch blocker |
| Export / deletion | `scaffold/user_deletion.py`, `USER_OWNED_TABLES`; export and deletion tests | Operator: synthetic full account export, deletion, token revocation, then verify export/deletion after restoration | Live-database deletion logic tested locally; deployed deletion and restore resurrection unverified, launch blocker |
| Backup retention / restore | `ops/backup_database.py`, `test_backup.py`, `test_backup_admin.py`: manifest-last, failure status, retention floor and secret exclusion | Operator + offline key holder: restore a staging archive into a disposable isolated database; verify schema, synthetic data, file checksums and deleted-account handling; record archive ID/time and outcome without credentials | **No offline restore performed by this audit. Launch blocker.** |
| OAuth grants / revocation | `scaffold/oauth/`, `test_oauth_server.py`, `test_mcp_audit.py`: scope boundary, resource audience, token/session split, live grant checks and audit pruning | Operator: separate account and admin connectors; disconnect a synthetic connection and verify the next call fails | Regression tested; deployed connection path unverified |
| Anonymous reports | `scaffold/routers/reports.py`, `test_reports.py`: details off by default, import codes instead of financial findings | Operator: inspect a synthetic anonymous report and its outbound notice; user-written report text can contain anything the reporter types | Tests passed; live notice/log redaction unverified |
| Shared office NAT | `scaffold/client_ip.py`, shared Redis limiter, `test_client_ip_and_rate_limit.py` | Operator: check resolved client IP in Admin, origin firewall, trusted hops and Redis; use several synthetic clients behind one egress | Config-sensitive; launch blocker until checked |
| Simulation contention | `app/retirement_simulation.py`: process/output bounds and two server simulation slots; browser simulation is separate | Operator: concurrent 100k-path requests plus ordinary reads/imports on staging; record queue/refusal/latency/RSS and recovery | Source bounded; load not measured here, launch blocker |
| Deploy / rollback | `.github/workflows/deploy.yml`, `OPERATIONS.md`, `REVIEW_POLICY.md` | Operator: staging migration/deploy health; rollback to a known image against representative schema, then restore forward; confirm production approval gate is actually Waiting | Source procedure exists; live drill unverified, launch blocker |
| Affiliation / company policy | Unofficial notice and policy copy are present | Rahul: record permission to publicize to employees and review wording that could imply endorsement | Human decision required; no company approval asserted |

Local targeted audit suite on 2026-11-24: **281 passed, 1 skipped** across upload hardening, backups/admin backups, OAuth, MCP audit, reports, account deletion, IP/rate limits and crypto. The skipped test is the real age-encryption round trip because `age` is unavailable; it is not evidence of a pass. Exact commands and test output belong in the PR. These checks validate repository behavior with synthetic fixtures, not the deployed service.

## Launch gate

Do not convert an unverified row to Passed based on a source comment. For each blocker, record the responsible person, environment, exact commit/deployment, date, procedure, observable result and a redacted evidence link. The operator owns operational checks; Rahul owns company permission and pilot recruitment. Re-run affected checks after material changes. Broad advertisement waits for operational blockers and the pilot's critical defects to clear; the candidate release is frozen except for usability, accuracy and security fixes.

Current decision: **Hold broad rollout pending live evidence and first-use pilot.** This does not block ordinary reviewed code fixes.

## Outstanding evidence handoff (2026-11-24 hygiene)

Use this record for **each** live check; empty entries are pending, never passes:

| Field | Required value |
|---|---|
| Owner | Responsible operator or authorized employee |
| Environment / build | Staging or production and exact deployed SHA |
| Performed at | UTC time of the actual check |
| Procedure | Command/runbook and synthetic fixture used |
| Result | Observable success, refusal or failure; no secret or financial payload |
| Evidence | Redacted log/artifact reference and related issue |
| Recheck trigger | Relevant configuration, code or schema change |

#664 needs authorized internal document-discovery verification (procedure in
`first-use-pilot.md`). #666 remains blocked on the live evidence rows above,
including the offline key holder's restore drill; passing repository tests
cannot fill these. #667 needs recruitment and actual uncoached observations;
the score calculator now validates denominators and blockers. #671 has daily
request counts and a de-identified pilot scoring path; production activation
tracking still needs an approved measurement model. Keep these issues open
until their specific evidence is attached. The four software regressions
#691/#693/#694/#695 are independently fixable without claiming rollout approval.
