# Expense planning workflow

One feature PR to staging covers the shared simulator, web planner and MCP card.

1. Preserve typed percentage text; test typing 140, clearing, pasting and editing.
2. Add explicit skip/wait purchase behavior, optional waiting deadline, monthly
   causal checks and ownership schedules anchored to actual purchases. Existing
   plans retain skip semantics. Test delayed purchases, expiration, replacements,
   debt, resale, ongoing costs, and matched-seed reproducibility.
3. Separate expense editing from results. Use category-specific controls, default
   cash purchases, ownership costs stopping at sale, and optional advanced fields.
4. Put core retirement inputs before expenses and core funding results before
   purchase outcomes. Share purchase probabilities, count and timing distributions
   between web and MCP. Distinguish purchases on funded paths from skipped wishes.
5. Provide Before retirement / Retirement planning views with a dated working-life
   funding schedule and retirement balance impact. Preserve the existing conservative
   deduction: wages, working-life investment returns and a multi-sale lot/tax forecast
   are not modeled in this PR. Funding labels are hypothetical, never transactions.
6. Give MCP separate results/edit/compare views in one active card. Open results
   without a form; return to results after running. Keep saves explicit and preserve
   the comparison's input snapshot. Do not rely on cross-card synchronization.
7. Run type checking, frontend/backend tests, relevant E2E and accessibility checks;
   update documentation and screenshots. Open one PR and request independent review
   using Needs Review. No feature merge before review clearance.

## Completed validation

- TypeScript build-mode type checking and full ESLint pass.
- Frontend: 682 tests across 44 files pass without unhandled errors.
- Backend: 117 retirement/MCP/UI/write tests pass.
- Browser: 22 portable MCP workflow/accessibility tests pass.
- Screenshots: 17 affected planning capture/accessibility cases pass, including
  light/dark mobile, desktop, date comparison, 140% entry, separate ownership
  controls and the saved expense review. Captures were inspected visually.
- Shared Node runtime exercised with a deterministic 1000-path deferred purchase.
- Independent review checked 36 always-eligible cash/financing/lifetime/cadence
  combinations against scheduled purchases, resale expiration, absolute cost
  cutoffs, saved tuition duration, and account-parameter preservation.

The final visual pass reduced entry to four core fields and one open topic at
any time, added visible selected planning views, made Save secondary in MCP,
and verified mobile comparison layout and dark-mode contrast. A pre-existing
sale-preview debounce leak exposed by validation was fixed with cancellation
cleanup and an unmount regression test. No sale calculations were changed.

Working-life income, investment returns and a multi-sale lot/tax forecast remain
outside this PR. The new funding schedule explicitly describes the existing
conservative retirement-wealth deduction and never creates transactions.
