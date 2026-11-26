# Submission readiness audit

Audit date: 2026-11-25. Local implementation is distinct from deployed behavior.
See [requirements](requirements.md), [public request evidence](evidence/production-public-probes.json),
[testing/deployment status](evidence/README.md) and platform checklists.

## P0 publication blockers

- **Production reviewer provisioning and host validation.** Reviewer sign-in
  is deployed. Provision separate fictional identities through approval-gated
  controls and test each actual host. The staging acceptance and production
  public checks are distinct from production authenticated/visual tests.
- **Public accessibility verified.** The exact-path Cloudflare changes are
  already live; the historical recipe is not an apply instruction.
  Reviewer sign-in, support, discovery and scriptless privacy
  (`/privacy-policy`, `/privacy.md`) are accessible. A 200 SPA shell is not
  evidence of a published terms page. See the
  [current production probes](evidence/production-public-probes.json).
- **OpenAI terms, identity and video.** Verified publishing identity and support
  contact are still required. Review `TERMS.md` and verify `/terms` on production.
  The [actual ChatGPT walkthrough](../evidence/epic-stocks-chatgpt-walkthrough.mp4) is recorded.
  The owner still needs to supply a reviewer-accessible video URL.
- **Actual-host validation and Anthropic carousel.** Existing screenshots show
  the website or local MCP host simulation. They are not proof of ChatGPT or
  Claude rendering. Capture 3–5 actual Claude app-response crops at >=1000px
  with prompts before an MCP App submission; no fabricated host screenshots.

## Implemented remediation

`scaffold/reviewers.py`, reviewer binding migration, separate login/admin API,
admin UI and admin MCP implement independent synthetic identities with existing
fictional profiles. Persistent writes use the real production services and
per-user encryption. Verifiers only; generated credentials appear once.
Expiry/revocation checked on browser, code exchange/refresh and MCP calls;
rotation invalidates sessions/codes/grants. Concurrent evaluations can provision
additional accounts without shared state. Reset requires explicit confirmation;
automatic staging cleanup preserves these accounts. No admin privilege or real
account selection. Detailed architecture: `docs/DIRECTORY_REVIEWERS.md`.

Financial write descriptions distinguish recording events from execution.
Projection certainty/assumptions already exist in price, event, retirement and
website services. Change sets preview/confirm and optimistic versions already
protect equity writes; reviewer generations now participate. No trade or money
movement API exists. Do not remove scenario planning because it handles money.

Privacy disclosures now describe connected assistants, opted-in diagnostics,
reviewer credentials, upload parsing and retention boundaries. Import guidance
avoids retrieving Claude user files/history and directs raw uploads to the
website parser. Necessary extracted fields can still be explicitly supplied.

## Existing controls inspected

- Separate session/MCP JWT types; canonical audiences; grants checked live.
- RFC 9728/8414 metadata, allowlisted exact/prefix redirect registration, S256
  PKCE, short authorization codes, rotating refresh tokens, explicit consent.
- Scoped tools use the same router/services as the website. Own-account-only
  resolution; typed schemas; bounded uploads; informative errors; MCP audit
  excludes tool arguments/results; connection/account rate limits.
- Versioned equity/retirement resources retain old URIs. Inline assets have
  no external network dependencies and empty resource/connect CSP allowlists.
  `CHATGPT_UI_ORIGIN` exists in deployment configuration but its effective
  production value and platform-approved unique origin require host inspection.
- Public setup, llms.txt, robots.txt and setup JSON already explain installation
  without MCP knowledge. Landing page already links setup/demo/import. Preserve
  this work instead of duplicating it.
- Existing deterministic CSV/PDF/XLSX imports, explicit change confirmation,
  per-user encryption, export/deletion services and optional diagnostics remain.

## Reporting coordination

PR [#746](https://github.com/rahulshahepic/epic-stocks/pull/746) merged into staging
as `5531a13` during this assignment. Its final scope includes public issue links
and separately consented encrypted support diagnostics/original failed-import
files, not only its earlier issue-form draft. The reviewer branch is
reconciled with that implementation; no parallel support-data store was added.

Ordinary `/api/report` reports remain anonymous by default and never attach
financial values or files automatically. `/api/report/with-consent` uses separate
explicit choices for diagnostics and originals, stores encrypted support material
outside ordinary report rows, excludes content from off-site backups, expires
access at 30 days and purges at scheduled cleanup or linked account deletion.
Browser admins and admin MCP need live role checks; the MCP also needs the
separately selected `admin:reports:sensitive` scope. Retrieval audits carry opaque
IDs only. Material may include financial diagnostics/originals explicitly shared
for support, not general access to another person's financial account. Copies
already retrieved by an assistant follow that provider's retention policy.

Reviewers can test this same workflow with fictional files only. Public issues
must never carry confidential prices, documents or unredacted screenshots.
Reporter/document text is untrusted and cannot approve administrative changes.

## Unresolved compatibility/policy questions

- Newest MCP revision is not automatically the revision required by each host.
  Existing negotiated 2025-03-26/2025-06-18 transport remains; do not blindly
  advertise 2026 protocol support without implementing/testing its semantics.
- OpenAI describes restricted data categories more precisely than “financial
  data forbidden.” Holdings/loans/planning remain useful; raw government IDs,
  credentials and payment fields should never enter tool arguments.
- Anthropic's file-extraction restriction is broader than its first-party API
  rule. Do not assert an exemption for user-uploaded files without clarification.
- Claude review criteria explicitly requires destructiveHint for modifying
  tools. All published financial writers now set the conservative true hint,
  including additive compensation records. Descriptions preserve append vs
  overwrite/delete semantics; idempotency remains independently accurate. This
  encourages host confirmation rather than evading it. Admin tools stay on a
  separate non-listing endpoint.
- Account-specific developer portals, live host mobile rendering, Cloudflare
  reviewer requests and deployed encryption/retention configuration cannot be
  proven by local tests alone. Mark them pending until observed.


Reviewer sign-in auditing was separated from the management journal after
independent Claude review identified anonymous journal eviction. Atomic daily
counts aggregate unknown usernames and expire after 90 days, including scheduled
cleanup. Supplied login text, passwords and IPs are not retained in these rows.
Admin MCP credential results are private conversation content; provider retention
applies. Browser-only provisioning avoids putting the generated credential in
an assistant transcript.
