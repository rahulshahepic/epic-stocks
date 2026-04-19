# Phase 2 plan: Content admin role + editable wizard content

> **Status:** Phase 1 has shipped. This file is the handoff brief for Phase 2.
> **As the final step of the Phase 2 PR, delete this file (`git rm docs/phase-2-content-admin-plan.md`).**
> Do not merge Phase 2 without that deletion — it's how we signal the work is done.

## Context

Phase 1 moved every wizard constant (grant schedule, loan rates, refi chains, bonus variants, grant-type metadata, DP-shares year cutoff, fallback tax rates, etc.) into six DB tables, exposed via read-only `GET /api/content`, and rewired `ImportWizard.tsx` to consume them. Seed data was preloaded with the exact Epic values — wizard behavior is byte-for-byte unchanged. **No new role, no edit UI, no write endpoints.**

Phase 2 is the user-facing half: a **content_admin** role that can edit all of the above from an in-app `/content` page, plus promoting the existing admin-only `flexible_payoff_enabled` toggle ("force same-tranche sales") to content-admin scope.

## Goals

- Admins can designate other users as content admins (persistently, via the Admin UI).
- Admins are implicitly content admins (the guard is `is_admin OR is_content_admin`).
- Content admins can CRUD all tables created in Phase 1: grant templates, grant type defs, bonus variants, loan rates, refi chains, wizard settings.
- Content admins can toggle `flexible_payoff_enabled` (currently an admin-only feature flag).
- A new `/content` page replaces no existing page; admins see both `/admin` and `/content` in nav.

## Schema changes (new migration)

Naming: `{12-hex}_add_content_admin_role_and_flexible_payoff.py`, `down_revision = 'q1r2s3t4u5v6'`.

1. `users.is_content_admin` — `Integer, default=0, nullable=False, server_default='0'`. **Not** refreshed on login (persistent, unlike `is_admin`).
2. `content_wizard_settings.flexible_payoff_enabled` — `Boolean, default=False, server_default='0'`. Migrate existing value from `system_settings` key `'flexible_payoff_enabled'` if present (may not exist — default to False). Leave the old row intact for one release, then drop it in a follow-up.

## Backend changes

### Auth dependency
- `backend/scaffold/auth.py` — add alongside `get_admin_user` (line 124-128):
  ```python
  def get_content_admin_user(user: User = Depends(get_current_user)) -> User:
      if not (user.is_admin or user.is_content_admin):
          raise HTTPException(status_code=403, detail="Content admin access required")
      return user
  ```

### Admin endpoints
- `backend/scaffold/routers/admin.py`:
  - `POST /api/admin/users/{user_id}/content-admin` → set `is_content_admin = 1`, 204 No Content.
  - `DELETE /api/admin/users/{user_id}/content-admin` → set `is_content_admin = 0`.
  - Extend `GET /api/admin/users` (line 112) response with `is_content_admin: bool`.
  - Update tests in `backend/tests/test_admin.py` — add coverage for promote/demote + 403 for non-admins.

### Content write endpoints
- `backend/app/routers/content.py` — extend with:
  - `PUT  /api/content/grant-templates/{id}` + `POST /api/content/grant-templates` + `DELETE /api/content/grant-templates/{id}`
  - Same CRUD shape for: `/grant-type-defs/{name}`, `/bonus-variants/{id}`, `/loan-rates/{id}`, `/refi-chains/{id}`.
  - `PUT /api/content/wizard-settings` — partial update for the singleton row; also accepts `flexible_payoff_enabled`.
  - All writes gated by `Depends(get_content_admin_user)`.
- Pydantic `*Create`/`*Update` schemas in `backend/schemas.py` for each table. Follow the existing `GrantCreate`/`GrantUpdate` pattern (validator guards — e.g. `show_dp_shares` requires Purchase `type`, `tax` loan rates require non-null `grant_type`, `purchase_original` rates require non-null `due_date`).
- Invalidate any frontend cache: Phase 1 `useContent` keeps a module-scoped singleton. After a successful write, the frontend must call `resetContentCache()` (already exported from `frontend/src/app/hooks/useContent.ts`) and re-fetch. Do that in the `/content` page's mutation handlers.

### Flexible-payoff toggle migration
- `backend/scaffold/routers/admin.py:463-476` — current `GET/POST /api/admin/flexible-payoff` keeps its shape but reads/writes `ContentWizardSettings.flexible_payoff_enabled` via the content service instead of `system_settings`. Preserves existing admin UI behavior.
- `backend/app/routers/sales.py:118, 167-173, 307` — the lookup of `flexible_payoff_enabled` switches source. No behavior change otherwise.
- Same toggle is also exposed in `PUT /api/content/wizard-settings` so content admins (not only admins) can change it from `/content`.

### `/api/me`
- `backend/main.py:575-596` — add `is_content_admin: bool` to the response. The frontend uses this to gate the nav link and the `/content` route.

## Frontend changes

### Role plumbing
- `frontend/src/scaffold/hooks/useMe.ts` — extend `Me` type: `is_content_admin: boolean`.
- `frontend/src/scaffold/components/Layout.tsx:34-36` — add:
  ```ts
  const canContent = me?.is_admin || me?.is_content_admin
  ```
  and append `{ to: '/content', label: 'Content' }` when `canContent`.

### `/content` page
- `frontend/src/app/pages/Content.tsx` (new). Tabbed layout:
  1. **Grant Templates** — editable table: year, type, vest_start (date), periods, exercise_date, default_catch_up, show_dp_shares, display_order, active, notes. Add/edit/delete rows.
  2. **Grant Type Defs** — table keyed by `name`: color_class, description, is_pre_tax_when_zero_price, display_order, active.
  3. **Bonus Variants** — table: grant_year, grant_type, variant_code, periods, label, is_default.
  4. **Loan Rates** — filter by `loan_kind`; columns vary slightly (e.g. due_date only for `purchase_original`, grant_type only for `tax`). One add-row form per kind.
  5. **Refi Chains** — grouped by `(chain_kind, grant_year, grant_type)`; within each group, rows are reorderable (order_idx); `orig_due_date` only for `tax`.
  6. **Wizard Settings** — single form for the singleton row. Includes the `flexible_payoff_enabled` toggle with explanatory helper text ("When off, loan-payoff sales are forced to the same-tranche method regardless of user preference").
- Route registration in `frontend/src/App.tsx`.
- Gate with `useMe()` — non-privileged users get 404 / redirect.
- Reuse admin table styling from `frontend/src/scaffold/pages/Admin.tsx`.

### Admin UI additions
- `frontend/src/scaffold/pages/Admin.tsx` — in the users list, add a "Content admin" toggle column. Wire to the new `POST/DELETE /api/admin/users/{id}/content-admin` endpoints.

### API client
- `frontend/src/api.ts` — extend the `api` object with:
  - `setContentAdmin(userId, enabled)` (admin-only).
  - `updateGrantTemplate`, `createGrantTemplate`, `deleteGrantTemplate`, plus analogous methods for the other five tables, plus `updateWizardSettings`.
  - Add `Create`/`Update` TS interfaces mirroring the new Pydantic schemas.

## Tests (mandatory per CLAUDE.md)

- `backend/tests/test_content.py` — extend with:
  - 403 when a non-admin, non-content-admin user hits any `/api/content/**` write endpoint.
  - 200 when an admin writes.
  - 200 when a content_admin (set via admin promote) writes.
  - CRUD coverage for each content table (add, update, delete, list via `GET /api/content`).
  - Validator failures (e.g. `purchase_original` without `due_date`).
  - `flexible_payoff_enabled` toggle via `PUT /api/content/wizard-settings` and via `POST /api/admin/flexible-payoff` should both modify the same underlying field.
- `backend/tests/test_admin.py` — extend with promote/demote tests, and `GET /api/admin/users` returns `is_content_admin`.
- `backend/tests/test_flexible_payoff.py` — update to confirm the toggle now reads from `content_wizard_settings`.
- Core-logic regression from `CLAUDE.md` must still hold: 89 events, final `cum_shares=558500`, `cum_income=$144,325`, `cum_cap_gains=$1,224,195`.
- `frontend/src/__tests__/Content.test.tsx` (new) — covers CRUD flows with mocked API.
- E2E spec in `frontend/e2e/` — login as admin, promote a second user, that user logs in, edits a rate, wizard reflects the new rate.

## UI / docs checklist (CLAUDE.md)

- `./screenshots/run.sh` after the new `/content` page lands — admin page gains a toggle column; `/content` is a new screen. Update `frontend/e2e/screenshots.spec.ts` to include `/content` (light/dark × mobile/desktop) and the admin users list with the new column.
- README.md updates per the mandatory checklist in `CLAUDE.md`:
  - New user-facing page (`/content`) — describe in "How to use".
  - New admin workflow (promote to content admin) — describe in admin/ops section.
  - New endpoints under `/api/content/**` and `/api/admin/users/{id}/content-admin` — document.
  - New code file references (`Content.tsx`, extended `content.py`) — update code-structure list.
  - Note the behavior change: `flexible_payoff_enabled` now lives in `content_wizard_settings`.

## Verification

1. `cd backend && alembic upgrade head` — migration runs, `is_content_admin` column appears, `flexible_payoff_enabled` migrates.
2. `cd backend && pytest` — all existing + new tests pass.
3. `cd frontend && npx tsc -b --noEmit && npx vitest run` — pass.
4. `./e2e.sh` — pass, including the new content-admin spec.
5. Manual: admin logs in → promotes user B → user B logs in → edits a 2024 interest rate → opens wizard → sees the edited rate flow through to the generated 2024 interest loan amounts.
6. `./screenshots/run.sh` — re-capture; commit new images.

## Files touched (summary)

**Backend new:** alembic migration `{hex}_add_content_admin_role_and_flexible_payoff.py`.
**Backend edited:** `scaffold/models.py` (User + ContentWizardSettings), `scaffold/auth.py`, `scaffold/routers/admin.py`, `scaffold/routers/auth_router.py` (leave alone — `is_content_admin` is NOT refreshed on login), `app/routers/content.py`, `app/routers/sales.py`, `app/content_service.py`, `main.py`, `schemas.py`, `tests/test_content.py`, `tests/test_admin.py`, `tests/test_flexible_payoff.py`.
**Frontend new:** `app/pages/Content.tsx`, `__tests__/Content.test.tsx`, `e2e/content-admin.spec.ts`.
**Frontend edited:** `scaffold/hooks/useMe.ts`, `scaffold/components/Layout.tsx`, `scaffold/pages/Admin.tsx`, `App.tsx`, `api.ts`.

## Final step

After all Phase 2 work lands and verifies green:

```
git rm docs/phase-2-content-admin-plan.md
git commit -m "Remove Phase 2 handoff plan — content admin role shipped"
```

Include that deletion in the same PR that lands Phase 2.
