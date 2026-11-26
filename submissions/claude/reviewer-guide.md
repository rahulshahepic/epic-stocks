# Anthropic reviewer guide

A secondary personal tracker for Epic employee equity and stock loans. Enter or import your records and explore how different assumptions affect estimated outcomes. Epic Stocks cannot service, refinance, or repay loans.

Epic Stocks provides recordkeeping and scenario estimates for information only. Its output is not professional financial, investment, legal, or tax advice.

Production server: **https://epic-stocks.com/mcp**. Authentication is required,
OAuth with DCR and S256 PKCE; no API key/custom static header needed.
Sign-in URL: **https://epic-stocks.com/reviewer-login**.

Credentials are supplied securely when review requests access, following
Anthropic's current instructions. They are not in this repository or submission
ZIP. The control center identifies deployment/testing gates still pending.

Connect the server, choose **Directory reviewer sign-in** on Epic Stocks' OAuth
login page, enter the provided Anthropic login/password and approve the ordinary
account scopes. Or sign in to the dedicated URL in the same browser before
connecting. No Google account, new email account, MFA, email link, SMS or manual
fixture creation is required.

First prompt: “Verify the active Epic Stocks account.” Expect synthetic=true,
initialized=true, platform=anthropic, scenario=established and a FICTIONAL notice.
The independent dataset contains invented grants, loans, prices, compensation,
retirement balances and conditional expenses. It never contains actual Epic
prices, real documents or another user's data. Stop if context differs.

Working examples:

- “Show my equity and explain my loan balances.” Open `show_equity`; compare
  `get_dashboard` and `list_loans`. Tabs and callbacks must keep the same account.
- “Compare retiring in 2032 and 2034.” Use `compare_retirement_scenarios`; explain
  assumptions and funding risks. Nothing saves from exploratory calculations.
- “Preview an estimated price of $1,000 for January 1, 2043.” `apply_changes`
  returns a preview/confirm token without saving. Explicitly confirm the exact
  change, then `list_prices` with projections enabled must show persistence.
- “Help me reconcile my fictional loan statement.” Use Epic Stocks website
  import for raw files and review/confirm the proposed records. Do not search
  Claude memory, history or uploaded files. A separate empty account can test
  onboarding using the fictional sample files linked in the asset manifest.
- “Explore a replacement car conditional on the retirement plan staying funded.”
  Use the retirement planning tools and distinguish modeled expenses from an
  actual purchase. Structured/text results remain useful if UI is unavailable.

Reject cross-account references and administrator access. Recording a historical
sale/payoff only edits tracking records; no securities or money ever moves.

State persists through review. Ask the publisher for a new independent account
or coordinated reset if needed. Resets never occur automatically. Extensions
and rotation invalidate old sessions/connections and require reconnecting.
Do not place credentials in public prompts, attachments or reports.
