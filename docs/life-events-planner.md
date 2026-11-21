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
real dollars in the retirement-year purchasing-power frame**. Annual costs
must be **additional to baseline spending**. They must not be entered twice.

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

- The current retirement engine starts at the retirement date. A **pre-retirement
  purchase's upfront net cash outlay and pre-retirement recurring/replacement
  expenses** are conservatively deducted from the retirement-date projected taxable portfolio. Pre-retirement wages, market
  returns on the spent cash, actual future stock sale lots, and pre-retirement
  debt service are not simulated. Payments on remaining loans after retirement
  are simulated. This is a scenario approximation, **not a verified pre-retirement
  cash-flow forecast**.
- A modeled Epic funding source is a label and net-cash target. It does **not**
  reserve or sell shares, mutate grants/loans/sales, or prove that vested shares
  will be available at a future price. Use the read-only `estimate_sale` for
  share-count and tax estimates; review vesting and loans separately.
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
