# Life events and major purchases: responsibilities and limits

This planner is a **hypothetical extension of retirement Monte Carlo**, not a
purchase, stock sale, mortgage application or brokerage order system.

## Supported events

The same dated `plannedEvents` schema handles:

- Home purchase / upgrade: price, down payment, fixed-rate amortizing loan,
  net proceeds from an existing home, incremental property tax / insurance /
  maintenance, optional later resale (net of remaining modeled loan).
- Vehicle purchase: cash or financed purchase, trade-in proceeds, incremental
  ownership costs, resale and periodic replacement. Repeated vacations and
  other recurring one-time expenses use the same cadence; the original amount
  repeats unless a different repeat cost is provided.
- College / tuition, childcare, eldercare, health expenses: one-time and/or
  annual costs with optional end date.
- Wedding, vacation / Disney, renovations, gifts and custom events: one-time
  expenses, annual incremental costs or both.

Events are capped at 20 per scenario. All dollar amounts are **millions of
real dollars in the retirement-year purchasing-power frame**. The web editor
labels that year on each amount and offers a current-sticker-price conversion
using the stated annual inflation assumption (2.5% by default). Annual costs
must be **additional to baseline spending**. They must not be entered twice.

## Causal purchase rules

Optional `condition` rules are combined with AND and checked on the scheduled
purchase month, after that month's market return and before withdrawals. They
never inspect future returns, terminal outcomes or eventual scenario ranks:

- `requireFullSpending`: buy only when the existing regular-spending ramp is
  at its full budget. If minimum equals default spending, this rule alone
  does not require portfolio growth; add a wealth threshold for that.
- `minPortfolioM`: current net portfolio must be at least this amount in
  retirement-year $M.
- `minStartingWealthRatio`: current net portfolio divided by initial retirement
  wealth. `1.2` means at least 120% of starting purchasing power. This is a
  real wealth threshold, **not** a simulation percentile or investment return.

Known unpaid taxes and earlier scheduled same-month event commitments reduce
wealth used for decisions. No rule guarantees the purchase is affordable after
future bills or taxes. A path with an earlier funding shortfall cannot initiate
another conditional purchase. Rules are supported only at/after retirement;
working-life market paths are not modeled. Conditions are evaluated once, with
no deferral or retry. A skipped initial asset generates no purchase, proceeds
from selling the old home/trade-in, loan payments, ownership costs or resale.
Each later scheduled replacement gets a fresh rule check, even if the first
purchase was skipped. Without a lifetime, replacements are cash purchases;
existing debt continues and no loan for a skipped initial purchase is created.
Skipping a replacement does not cancel existing bills.

Results report each conditional event's probability of buying at least once,
never buying, and average purchase count. Purchases outside the simulation
horizon are excluded from the outcome summary. Read risk reductions alongside purchase
probabilities: never buying the optional item is different from funding it.

## Vehicle lifetime and depreciation

`lifetimeYears` (1–50 whole years) creates an automatic sale after that ownership
period. `depreciationRate` is annual **nominal** depreciation, from 0 to 1. For a
purchase cost P and lifetime L, real sale proceeds are
`P * ((1 - depreciationRate) / (1 + inflationRate)) ** L`, with 2.5% inflation
by default. Zero depreciation retains the nominal purchase price, not its real
purchasing power. This is an assumption, not a prediction of collectible prices.
Allow for selling fees in the depreciation assumption.

Sale proceeds pay remaining modeled loan principal and stop annual costs. The
sale month includes its final ownership cost and loan payment, matching explicit
resale handling. Do not combine lifetime with explicit resale date/value.
With a repeat interval (at least as long as the lifetime), each replacement has
its own purchase decision, loan, ownership period and sale. Replacements do not
reuse the original trade-in offset. A skipped cycle cannot produce resale cash;
a later scheduled cycle can still pass its own conditions. `endDate` remains an
absolute stop date for annual costs across cycles. Replacements are optional:
lifetime alone means buy once, use, then sell.

## What the app must calculate (deterministic and auditable)

1. Date-ordered event cash flows, mortgage/loan amortization and remaining debt.
2. Upfront net cash requirement after trade-in / prior-home proceeds.
3. Post-retirement ownership costs, loan payments, replacement and resale cash.
4. A portfolio path with each expense funded from cash, taxable brokerage and
   eligible tax-advantaged accounts, using the existing retirement tax engine.
5. Matched-seed baseline and event scenarios, including shortfall and terminal
   wealth percentiles. Keep funded-path and exhaustion risks separate.
6. A pre-retirement net-cash target for **hypothetical** Epic sales. A separate
   `estimate_sale` call can calculate lot-based shares/taxes using an explicitly
   stated assumed price and date. The planner never invokes a write tool.

## What the AI should handle

- Convert conversational intent ("bigger house in 2030", "Disney every third
  summer", "four years of tuition") into a **draft** of typed events.
- Ask for financially material missing values, especially current-home net
  proceeds, mortgage rates, dates, school costs, taxes, price assumptions and
  what is already in baseline spending. Do not silently invent a rate or price.
- Offer comparisons and sensitivity tests (purchase date, financing, smaller
  home, retirement date, stock-sale timing) using the actual app calculator.
- Explain uncertainty and distinguish after-tax **cash target** from a verified
  executable share count.
- Present estimates in plain language, never as trading instructions.

The AI does **not** calculate tax, debt amortization or Monte Carlo odds from
scratch. The app does not guess what the user wants.

## Important limits

- The current retirement engine starts at the retirement date. **Future
  pre-retirement upfront outlays, remaining mortgage payments and incremental
  recurring/replacement expenses** are conservatively deducted from projected
  retirement-date taxable wealth. Already-paid historical purchase costs and
  past loan payments are excluded. Pre-retirement wages, market returns on
  spent cash and actual future stock sale lots are not simulated.
  Remaining loan payments after retirement are modeled separately. This is a
  scenario approximation, **not a verified pre-retirement cash-flow forecast**.
- When future pre-retirement spending exceeds the modeled taxable funds,
  `preRetirementFundingGapM` is the unmet cash need. The engine does not
  invent an early IRA withdrawal or pretend the locked balance financed it.
  The browser suppresses Monte Carlo affordability odds and ending-wealth
  charts for that infeasible plan. MCP marks `modelFeasible=false`, supplies
  a warning and suppresses before/after deltas. Any simulated remaining
  wealth is conditional and must not be quoted as an affordable outcome.
  This policy applies even if the owner will be over 59½ before retirement:
  the working-life tax, withdrawal and earnings path is not modeled.
- A modeled Epic funding source is a label and net-cash target. It does **not**
  reserve or sell shares, mutate grants/loans/sales, or prove that vested shares
  will be available at a future price. Use the read-only `estimate_sale` for
  share-count and tax estimates; review vesting and loans separately.
- The optional end date stops incremental annual costs. It does not cancel
  scheduled vehicle replacements or recurring one-time purchases; a modeled
  resale date stops later replacements. Change the replacement cadence to zero
  to model a single purchase.
- Home equity is excluded from liquid retirement assets until a modeled sale.
  Resale proceeds are reduced by modeled outstanding loan principal; selling
  costs and taxes must be included in the entered proceeds/value assumptions.
- Mortgage rates are nominal and fixed; payments are deflated to real dollars using event inflation (2.5% default), with no refinancing, adjustable rates or itemized
  mortgage-interest deduction. Loan terms are whole years. Recurring expenses
  are assumed constant in **real** dollars.
- This is planning, not advice or a guarantee of purchase affordability or
  mortgage approval. Funded-path probability is a model result.

## Safety and data model

`plannedEvents` is part of the existing retirement params JSON. The web app
may autosave the scenario, just as it saves other retirement assumptions.
**This does not create real transactions or sales.** MCP
`run_retirement_simulation`, `compare_retirement_scenarios` and
`plan_life_events` remain read-only. Only the separately permissioned
`update_retirement_params` may save the scenario as a plan.

The Python MCP boundary validates the entire typed event list, including
finite amounts, unique IDs, supported categories, date order and bounded
terms. The shared TypeScript simulation engine powers both web and Node MCP
execution.

## Follow-up engineering

A future pre-retirement cash-flow model can replace the conservative
retirement-date deduction with salary, taxes, vesting, mortgage payments,
inflation and investment returns across the entire working-life interval.
Do not imply this already exists.
