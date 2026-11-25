# Claude connector and plugin answers

Current public field requirements checked 2026-11-25. Unknown authenticated-form
fields require owner completion; no personal/company facts are invented.

## Connector form

| Step/field | Value |
|---|---|
| Connection | One URL: https://epic-stocks.com/mcp |
| Tools | Sync from live server; resolve warnings before submission |
| Server name (<=100) | Epic Stocks (Unofficial) |
| One-liner (<=200) | Understand Epic employee equity and loans, reconcile your records, and compare retirement scenarios. |
| Slug | epic-stocks-unofficial — check availability; permanent once published |
| Categories (1–5) | Choose the live categories matching personal finance, productivity and planning; do not invent unavailable labels |
| Documentation | https://epic-stocks.com/mcp-setup |
| Privacy | https://epic-stocks.com/privacy |
| Support contact | **OWNER:** actual monitored contact; public GitHub issues are unsuitable for confidential reports |
| Icon | Shared existing 512×512 SVG/PNG brand assets; manifest below |
| Authentication | Required; OAuth 2.0, DCR (oauth_dcr), S256 PKCE; no Anthropic-held client secret required |
| API ownership | Our own Epic Stocks service. No Epic corporate API, brokerage or bank API is called. |
| Personal health data | No health records requested; retirement planning may include an optional user-entered insurance-cost assumption. |
| Sponsored content | No |
| Company name/website | **OWNER:** actual submitting identity; website https://epic-stocks.com. Do not represent Epic Systems as publisher. |
| Primary review contact | **OWNER:** actual monitored contact |
| Prerequisites | Epic Stocks account and OAuth consent; ordinary users supply their own records. Reviewer accounts are prepopulated and do not need Google or external documents. |
| Read/write capabilities | Both, within selected ordinary OAuth scopes. Equity changes preview/confirm; exploratory planning does not save. |
| Allowed link URIs (optional) | https://epic-stocks.com — only if links from these tools require it; no unrelated domains |
| Test & launch | **PENDING:** confirm every tool in Claude/Inspector only after actually testing; do not enter credentials here. |
| Seven policy acknowledgments | **OWNER:** personally review directory, API ownership, transactions, media, prompt injection, conversation data and public-doc acknowledgments. |

Description (under 2,000 characters):

> Epic Stocks helps Epic employees understand their equity and stock loans from
> records they enter or import. Review grants, vesting, loan balances and
> estimated departure proceeds; reconcile records; and explore compensation,
> retirement dates and planned expenses. Equity and retirement tools use the
> website's calculations and provide structured/text results when interactive
> views are unavailable. Proposed equity edits are previewed for confirmation.
> Recording a completed sale or loan payoff changes tracking records only. The
> app never executes securities trades or moves money. Projections depend on
> assumptions, are uncertain and are not guarantees or professional tax or
> investment advice. Independent project, not made, endorsed or supported by
> Epic Systems Corporation.

Primary use cases/prompts:

1. “Show my equity and explain my outstanding stock loans.”
2. “Help reconcile the grant and loan figures I provide, previewing any changes.”
3. “Compare retirement dates using my spending assumptions and explain the risks.”

Data handling:

> Only necessary account data is read or written through selected OAuth scopes.
> No Claude memory, chat history, summaries or files are retrieved. Raw imports
> can be parsed on the Epic Stocks website without an LLM; users may explicitly
> supply minimal financial fields for reconciliation. Financial records remain
> account-isolated; connected assistant results are processed under its own
> terms. MCP audits contain tool names/scopes/outcomes rather than financial
> arguments or results. Diagnostic and failed-import file sharing requires separate explicit consent.
> Encrypted support material expires after 30 days and is excluded from scheduled
> backups; a separate administrator connector requires its sensitive-report scope
> to retrieve those contents. Review uses isolated
> fictional accounts; no actual Epic prices or confidential documents.

## Plugin bundle form

Repository: `https://github.com/rahulshahepic/epic-stocks`

Plugin path: `submissions/claude/plugin`

Tracked branch: **main** (explicit; staging is the repository default).

Use the same owner organization as the connector. Validate the final production
commit, review populated manifest/listing fields, pair with the connector using
its exact same URL, and personally complete policy acknowledgments. The bundled
onboarding skill supplies a useful first-run workflow without changing the
server's permissions. No local server, agents or hooks are needed.

Screenshots: 3–5 actual-host app-response PNG crops, >=1000px wide, paired prompts
separately. Existing website/local-host screenshots are supplemental and must
not be labeled actual Claude carousel captures. See the shared asset manifest.
