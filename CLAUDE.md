# CLAUDE.md

## Project Overview
Equity vesting tracker PWA. See SPEC.md for full requirements.

## Key Rules
- **backend/core.py is frozen.** Do not modify the core event generation logic. It is tested and verified. If you need to change event computation behavior, discuss first.
- **Events are never stored in the database.** They are computed on the fly from Grants + Loans + Prices via core.py.
- **backend/excel_io.py contains the Excel read/write logic.** Adapt as needed for the import/export endpoints but preserve the column mappings.
- **test_data/fixture.xlsx is a synthetic test fixture.** Use it to validate import logic. It contains no real data.

## Tech Stack
- Backend: Python 3.12, FastAPI, SQLite (WAL mode), SQLAlchemy
- Frontend: React, TypeScript, Vite, Tailwind CSS, Recharts
- Deploy: Docker Compose + Caddy (auto-HTTPS)
- Auth: Google Sign-In (OAuth 2.0) → backend JWT session tokens

## Build Order
Follow the order in SPEC.md. Build backend first, then frontend. **Every step must include tests before moving on.** Ask before making architectural decisions.

## Testing Rules
- **No feature without tests.** Write tests alongside or before the implementation, not after.
- Backend: pytest. Use test_data/fixture.xlsx as a fixture for import/export tests.
- Frontend: Vitest + React Testing Library.
- E2E: Playwright, mobile viewport (375x812), chromium only.
- Known-good values for core logic validation: 89 events, final cum_shares=269843, cum_income=$144,325, cum_cap_gains=$1,243,695.

## CI/CD
- GitHub Actions runs tests on every push and PR.
- Deploy to VPS via SSH on push to main (after tests pass).
- See SPEC.md for full workflow definitions.

## Code Style
- Python: minimal comments, concise, no unnecessary abstractions
- TypeScript: functional components, hooks, Tailwind utility classes
- Mobile-first responsive design — this is primarily used on a phone
