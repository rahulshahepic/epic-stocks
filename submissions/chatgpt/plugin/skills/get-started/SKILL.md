---
name: get-started
description: Help a user connect Epic Stocks, reconcile their explicitly supplied equity records, and explore compensation and retirement planning.
---

Epic Stocks is an independent, unofficial Epic employee equity recordkeeping
and planning app. It does not execute trades, pay loans or move money.

When the user requests setup:

1. Connect the bundled Epic Stocks server and complete its OAuth sign-in and
   permission consent. Credentials belong in the sign-in page, never chat/tool
   arguments. Read permissions suffice for questions; saving needs editing
   permissions. Do not request admin permissions.
2. Verify the active account with `get_account_context`. A reviewer account
   must identify its data as fictional. Keep fictional examples separate from
   personal records. An uninitialized staging workspace follows the staging
   setup flow; production reviewers arrive prepopulated.
3. Read `get_dashboard`, `list_grants` and `list_loans` for the user's requested
   reconciliation. An empty account needs records before meaningful equity
   estimates. Explain the fields needed one step at a time.
4. For raw documents, direct the user to https://epic-stocks.com/import, or
   https://epic-stocks.com/try before sign-in. The website parses share-summary
   CSVs, stock loan statements and workbooks without sending them to an LLM.
   A Docusign purchase agreement can supply grant terms the user explicitly
   provides. Do not retrieve assistant memory, history or summaries, or search
   user files. Only process explicitly supplied redacted documents where the host
   permits it; Claude directory file-extraction restrictions mean raw documents
   should use the website parser. Do not solicit government IDs, signatures,
   passwords or payment credentials.
5. Use only necessary financial fields the user intentionally supplies. Compare
   existing records to avoid duplicates. Identify assumptions and missing dates.
   Do not delete records merely because a document omits them.
6. Preview equity edits with `apply_changes` without `confirm`. Explain exactly
   what changes and what remains uncertain. Apply identical edits only after
   the user agrees, with that preview's confirmation token. Read back and
   reconcile the saved position. Recording a sale/payoff never executes one.
7. Explain vesting, loan principal/accrued interest, and estimated taxes from
   the server results. Use `show_equity` when a visual overview helps; structured
   read tools provide a fallback if the host cannot render it.
8. Explore compensation, departure and retirement scenarios only as requested.
   `show_retirement`, `run_retirement_simulation` and
   `compare_retirement_scenarios` use assumptions and uncertain outcomes.
   Conditional expenses are modeled plans, not purchases. Exploratory overrides
   do not save; save named settings only when requested. Verify units before
   saving: retirement balances use millions of dollars in MCP parameters.
9. Explain disconnect/export/deletion controls and link the privacy policy at
   https://epic-stocks.com/privacy-policy when relevant. Do not repeat legal boilerplate
   on every result; state material assumptions and uncertainty where needed.
