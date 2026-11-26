# OpenAI reviewer guide

A secondary personal tracker for Epic employee equity and stock loans. Enter or import your records and explore how different assumptions affect estimated outcomes. Epic Stocks cannot service, refinance, or repay loans.

Epic Stocks provides recordkeeping and scenario estimates for information only. Its output is not professional financial, investment, legal, or tax advice.

Production MCP endpoint: **https://epic-stocks.com/mcp**. OAuth with dynamic
registration and S256 PKCE. Credential sign-in:
**https://epic-stocks.com/reviewer-login**. This guide applies after deployment;
the control center records whether that gate has completed.

The private Review details field supplies a dedicated OpenAI login/password.
Start Connect, choose Directory reviewer sign-in on the Epic Stocks login page,
enter those credentials, then approve Equity read/edit and Compensation
read/edit as needed. Alternatively sign in to the reviewer URL first in the same
browser. No email, Google account, MFA or external financial dataset is needed.
The account is fully fictional, independently writable and persistent. Its
invented prices are not Epic share prices. It has no administrator access.

1. “Verify my active account.” Expect synthetic=true, initialized=true,
   platform=openai and established scenario. Never proceed if these differ.
2. “Show my equity overview and explain my outstanding stock loans.” Expect
   `show_equity`, `get_dashboard`, `list_loans`: fictional holdings, loan amounts,
   vesting and projection labels; no trades or loan payment execution.
3. “Compare retiring in 2032 versus 2034 using my saved spending assumptions.”
   Expect `compare_retirement_scenarios`, assumptions and uncertain simulation
   results. Exploratory overrides must not save settings.
4. “Preview adding an estimated price of $1,000 effective January 1, 2043.”
   Expect `apply_changes` preview and confirmation token; no saved change yet.
   Confirm the exact preview, then read prices with projections enabled. This
   creates a tracking assumption, not a market quote or securities transaction.
5. “I want to record a sale that already occurred.” Expect a request for missing
   date/shares/price and a preview; nothing executes on a brokerage or bank.
6. Open equity tabs, retirement controls, compare scenarios, and conditional
   expense plans. If UI is unavailable, use structured/text tool results and
   explain the same assumptions. Rendering must be verified in ChatGPT itself.
7. For onboarding, use a separate empty reviewer supplied privately. Import
   the repository's fictional files through the website parser, review proposed
   changes, confirm, then reconcile grants/loans and retirement assumptions.

No changes affect another platform's account. Do not reset mid-evaluation.
If a fresh dataset is needed, ask the publisher to provision a new independent
reviewer or arrange an explicit reset. Credentials cannot be self-rotated by a
reviewer. An expired account requires an administrator's approved extension.

Negative cases: requesting another person's account must fail; asking to trade
shares/move money must yield an explanation that this app only tracks records;
unconfirmed edits must not persist. Do not send real documents or credentials
in tool arguments. Credentials belong only in the login form.
