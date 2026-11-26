# ChatGPT listing and review answers

Verified field reference: 2026-11-25. Use the candidate plugin manifest for
machine-imported fields. Check the live authenticated form for additional
required fields. Do not submit until the checklist is clear.

| Field | Ready-to-paste value |
|---|---|
| Application/display name | Epic Stocks (Unofficial) |
| Subtitle (30-character maximum) | Equity and retirement planning |
| Category | Productivity (choose a finance category if the live selector offers a better applicable category) |
| Website | https://epic-stocks.com |
| Support URL | https://epic-stocks.com/support |
| Privacy | https://epic-stocks.com/privacy-policy |
| Terms | https://epic-stocks.com/terms (verify the published page after production deployment) |
| MCP URL | https://epic-stocks.com/mcp |
| Authentication | OAuth; Dynamic Client Registration. No static headers or embedded credentials. |
| Developer identity/name/contact | **OWNER:** use the verified individual/organization in the dashboard and your actual support contact. GitHub handle is rahulshahepic; it is not evidence of developer verification. |
| Commerce | No. The application does not sell securities, initiate transactions or move money. |
| Country availability/legal acknowledgments | **OWNER:** select applicable supported countries and review/accept required attestations yourself. No legal declaration is made by these materials. |
| Walkthrough URL | [Actual ChatGPT recording](../evidence/epic-stocks-chatgpt-walkthrough.mp4) captured using fictional data. Supply an accessible video URL for review. |

Long description (under 4,000 characters):

> Understand your Epic employee equity and stock loans using records you enter
> or import. Review grants and vesting, reconcile outstanding loans, estimate
> departure proceeds after loans and taxes, and compare compensation and
> retirement scenarios. Interactive equity and retirement views use the same
> calculations as the website. Proposed equity edits are previewed before you
> confirm them. Estimates depend on your inputs and assumptions; future returns
> and tax outcomes are uncertain. Recording a sale or payoff updates tracking
> records only: Epic Stocks does not execute trades or move money. Independent
> project, not made, endorsed or supported by Epic Systems Corporation.

Starter prompts (each <128 characters; maximum three):

1. Show my equity and explain my outstanding stock loans.
2. Help me reconcile my grants and loans with my records.
3. Compare retirement dates using my saved spending assumptions.

Data collection/use explanation:

> Ordinary sign-in uses Google or another configured identity provider and
> receives basic profile information, not the provider password. The app stores
> user-entered equity, loan, price, compensation, optional birth-date and
> retirement-planning records. Selected OAuth read scopes disclose requested
> records/results to the connected assistant; write scopes permit authorized
> record changes. MCP logs contain tool names, scopes, times and outcomes,
> not financial arguments/results. The server parses import files without an
> LLM. Users control excerpts separately shared with their assistant. Export,
> disconnect, reset and deletion controls are available. Separately consented
> support diagnostics and original failed-import files are encrypted, excluded
> from scheduled backups and expire after 30 days. They may be retrieved by
> administrator-connected assistants only with the sensitive-report permission;
> ordinary admin MCP access exposes stubs, not those contents. Browser admins
> can retrieve explicitly consented support material through an audited view.

Permissions:

> equity:read reads holdings, grants, loans, recorded sales and projections;
> equity:write previews and applies confirmed tracking edits. comp:read reads
> compensation and retirement settings/results; comp:write saves named values
> when requested. import:propose supports existing import preparation and does
> not itself apply records. Users choose individual permissions on consent and
> can disconnect at any time. Admin permissions belong to a separate unlisted
> endpoint and are never requested by this public package.

Reviewer details: paste the [reviewer guide](reviewer-guide.md) into the secure
review instructions field and provide credentials privately after production
provisioning. Do not include passwords in the plugin ZIP. Five positive and
three negative cases are provided in the candidate manifest and
[review cases](review-cases.json). No claims of completed host tests are made.
