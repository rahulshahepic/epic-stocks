# Anonymous demo implementation decision

Issue #668 needs a new source of fictional data that can drive the real dashboard, exit/sale what-ifs and retirement engine without an account or any production writes. The existing `/try` response supports dashboard/events but currently calculates parts of its view in React and withholds sales/retirement. Relabeling that view a full demo would not satisfy the issue or canonical-calculation parity.

The repository asks contributors to discuss architectural decisions before implementation. Rahul approved the synthetic input adapter on November 24, 2026. The implementation uses explicit request-local `CalculationInputs`, also loaded from account rows for the existing dashboard/events/exit paths.

## Proposed implementation

Use a request-scoped synthetic-data adapter for the existing calculation services. Extract the existing input-loading boundary from database I/O, retaining the established loan, vesting, sales, dashboard and exit services as the only calculations. The account path supplies its current rows; a demo path supplies one of three immutable, versioned fictional profiles (roughly 3, 10 or 20 years of tenure) plus bounded what-if inputs. Retirement keeps the existing simulator. The adapter must never borrow an authenticated account or its key context.

The demo route does not create users, upload files, send notifications, or write account rows. Every response clearly labels fictional records and invented prices. Browser-only edits reset to the selected profile. Switching to personal import clears demo state, and demo data never enters the signup carryover storage key.

Tests must compare each profile's dashboard, events, sale/exit and retirement assumptions against those same real services with equivalent synthetic fixtures. Include concurrent demo requests, independent profiles, malformed/oversized what-ifs, reset, mobile/desktop/accessibility and proof that no real account rows change. Apply the existing resource limits, not just an office-IP throttle.

## Alternatives and tradeoffs

| Choice | Tradeoff |
|---|---|
| **Synthetic input adapter (recommended)** | One calculation path and no storage, but requires a careful service-boundary refactor and parity tests. |
| Request-local disposable database | Reuses current router/session contracts with less refactoring, but database/schema setup per request adds cost and requires strict concurrency/isolation and cleanup tests. Never point it at the production database. |
| Browser-only demo based on the current trial response | Smallest initial change, but cannot meet the canonical dashboard/sales/exit requirement without duplicating financial calculations. Not recommended. |

Decision: **approved — synthetic input adapter** (Rahul, November 24, 2026). The `/demo` runtime uses three versioned fictional profiles and the account services. Retirement runs the existing simulator in a browser worker (2,000 paths); it creates no account or server simulation job. Reset and switching to personal import do not copy fictional records to storage. Equivalent encrypted-account parity tests cover dashboard, events and exit at current and future dates.

Internal Eureka document navigation, deployment restore evidence and recruiting the usability pilot remain separate dependencies recorded in the readiness checklist.
