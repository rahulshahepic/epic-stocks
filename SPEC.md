# Equity Vesting Tracker — Technical Reference

## Data Model

Three source-of-truth tables. Events are computed on the fly — never stored.

### Grants
```
id, user_id, year, type, shares, price, vest_start, periods, exercise_date, dp_shares
```
- `type`: "Purchase", "Catch-Up", "Bonus", "Free"
- `price`: purchase price per share (0 for Catch-Up, Bonus with zero basis, Free)
- `vest_start`: date when first vesting period begins
- `periods`: number of annual vesting periods
- `exercise_date`: date the grant was exercised (typically 12/31 of grant year)
- `dp_shares`: down payment shares exchanged (negative number, 0 for most grants)

### Loans
```
id, user_id, grant_year, grant_type, loan_type, loan_year, amount, interest_rate, due_date, loan_number
```
- `grant_type`: "Purchase", "Catch-Up", "Bonus" (which grant this loan is associated with)
- `loan_type`: "Purchase", "Interest", "Tax"
- `loan_number`: the 6-digit loan identifier from Epic's statements

### Prices
```
id, user_id, effective_date, price
```
- One row per annual share price announcement
- First entry is the initial price at the first exercise (e.g., 2018-12-31 @ $1.99)
- Subsequent entries are typically 3/1 of each year

### Events (computed, never stored)
Generated from Grants + Loans + Prices. Five event types:
- **Exercise**: one per grant, on exercise_date
- **Down payment exchange**: one per grant where dp_shares != 0
- **Vesting**: one per grant × period (shares/periods per event, remainder distributed to early periods)
- **Share Price**: one per price point after the first (captures the delta)
- **Loan Repayment**: one per loan (sells shares to cover loan principal at due date)

Each event carries: date, grant_year, grant_type, event_type, granted_shares, grant_price (cost basis), exercise_price, vested_shares, price_increase.

The timeline computation walks events chronologically and calculates running:
- `share_price` — cumulative from price increases
- `cum_shares` — cumulative vested minus repaid
- `income` — vesting where cost basis = 0: shares × price
- `cap_gains` — vesting where cost basis > 0: (price − basis) × shares; plus price_increase × prior cum_shares
- `cum_income`, `cum_cap_gains` — running totals

## Core Logic

The following is the complete, frozen event generation and timeline computation module (`backend/core.py`). Do not modify it. Use as-is.

```python
"""Core event generation — no I/O dependencies."""
import math
from datetime import datetime
from dateutil.relativedelta import relativedelta

_TYPE_ORDER = {
    'Share Price': 0, 'Exercise': 1, 'Down payment exchange': 2,
    'Vesting': 3, 'Loan Repayment': 4,
}
_LOAN_TYPE_ORDER = {'Purchase': 0, 'Interest': 1, 'Tax': 2}


def generate_exercise_events(grants):
    return [{
        'date': g['exercise_date'],
        'grant_year': g['year'],
        'grant_type': g['type'],
        'event_type': 'Exercise',
        'granted_shares': g['shares'],
        'grant_price': g['price'],
        'exercise_price': 0.0 if g['price'] == 0 else g['price'],
        'vested_shares': None,
        'price_increase': 0.0,
        'source': {'type': 'grant', 'index': i},
    } for i, g in enumerate(grants)]


def generate_dp_events(grants):
    return [{
        'date': g['exercise_date'],
        'grant_year': g['year'],
        'grant_type': g['type'],
        'event_type': 'Down payment exchange',
        'granted_shares': None,
        'grant_price': None,
        'exercise_price': None,
        'vested_shares': g['dp_shares'],
        'price_increase': 0.0,
        'source': {'type': 'grant', 'index': i},
    } for i, g in enumerate(grants) if g['dp_shares'] != 0]


def generate_vesting_events(grants):
    events = []
    for i, g in enumerate(grants):
        shares = g['shares']
        periods = g['periods']
        base = shares // periods
        remainder = shares % periods
        for p in range(periods):
            vest_date = g['vest_start'] + relativedelta(years=p)
            events.append({
                'date': vest_date,
                'grant_year': g['year'],
                'grant_type': g['type'],
                'event_type': 'Vesting',
                'granted_shares': None,
                'grant_price': g['price'],
                'exercise_price': None,
                'vested_shares': base + (1 if p < remainder else 0),
                'price_increase': 0.0,
                'source': {'type': 'grant', 'index': i},
            })
    return events


def generate_price_events(prices):
    return [{
        'date': prices[i]['date'],
        'grant_year': None,
        'grant_type': None,
        'event_type': 'Share Price',
        'granted_shares': None,
        'grant_price': None,
        'exercise_price': None,
        'vested_shares': None,
        'price_increase': round(prices[i]['price'] - prices[i - 1]['price'], 2),
        'source': {'type': 'price', 'index': i, 'prev_index': i - 1},
    } for i in range(1, len(prices))]


def generate_loan_repayment_events(loans):
    return [{
        'date': loan['due'],
        'grant_year': loan['grant_yr'],
        'grant_type': loan['loan_type'],
        'event_type': 'Loan Repayment',
        'granted_shares': None,
        'grant_price': None,
        'exercise_price': None,
        'vested_shares': None,
        'price_increase': 0.0,
        'source': {'type': 'loan', 'index': i, 'amount': loan['amount']},
    } for i, loan in enumerate(loans)]


def sort_events(events):
    def key(e):
        return (
            e['date'],
            _TYPE_ORDER.get(e['event_type'], 5),
            _LOAN_TYPE_ORDER.get(e['grant_type'], 5),
            e['grant_year'] or 9999,
            e['grant_type'] or 'ZZZ',
        )
    return sorted(events, key=key)


def generate_all_events(grants, prices, loans):
    events = (
        generate_exercise_events(grants)
        + generate_dp_events(grants)
        + generate_vesting_events(grants)
        + generate_price_events(prices)
        + generate_loan_repayment_events(loans)
    )
    return sort_events(events)


def compute_timeline(events, initial_price):
    price = initial_price
    cum_shares = 0
    cum_income = 0.0
    cum_cap_gains = 0.0
    result = []

    for e in events:
        prev_cum_shares = cum_shares
        price += e['price_increase']

        vs = e['vested_shares'] or 0
        if e['event_type'] == 'Loan Repayment' and e.get('source'):
            amount = e['source'].get('amount', 0)
            vs = -math.ceil(amount / price) if price > 0 else 0

        cum_shares += vs
        cb = e['grant_price'] or 0

        income = vs * price if (e['event_type'] == 'Vesting' and vs > 0 and cb == 0) else 0.0
        vesting_cg = (price - cb) * vs if (e['event_type'] == 'Vesting' and vs > 0 and cb > 0) else 0.0
        price_cg = e['price_increase'] * prev_cum_shares

        total_cg = vesting_cg + price_cg
        cum_income += income
        cum_cap_gains += total_cg

        result.append({
            **e,
            'vested_shares': vs if vs != 0 else e['vested_shares'],
            'share_price': round(price, 2),
            'cum_shares': cum_shares,
            'income': round(income, 2),
            'cum_income': round(cum_income, 2),
            'vesting_cap_gains': round(vesting_cg, 2),
            'price_cap_gains': round(price_cg, 2),
            'total_cap_gains': round(total_cg, 2),
            'cum_cap_gains': round(cum_cap_gains, 2),
        })

    return result
```

## Excel Import Column Mappings

**Schedule sheet** (→ Grants), rows 2+:
- A: year, B: type, C: shares, D: price, E: vest_start, F: periods, N: exercise_date, O: dp_shares

**Loans sheet**, rows 2+:
- A: loan_number, B: grant_year, C: grant_type, D: loan_type, E: loan_year, F: amount, G: interest_rate, H: due_date

**Prices sheet**, rows 2+:
- A: effective_date, B: price

Ignore the Events sheet on import — it's derived. Only sheets present in the uploaded file are replaced; others are left untouched.

## Key Implementation Notes

1. **core.py is the source of truth for all event logic.** Do not reimplement it in TypeScript or call it from the frontend. The frontend calls `/api/events` and gets the computed timeline.

2. **Events are never persisted.** Computed per-request from the three source tables.

3. **Date handling**: All dates stored as ISO strings in the database. Python side uses datetime objects. Frontend displays in local timezone.

4. **The "Add Another" pattern**: Every create form needs both "Save" (closes) and "Save & Add Another" (saves, clears, stays open). Critical for loan entry — users enter 10–20 loans at once from a statement.

5. **Import is per-sheet, not all-or-nothing.** Only sheets present in the uploaded file are replaced. The flow: validate → preview → write (single transaction). A backup snapshot of affected data is saved automatically before each import (last 3 kept per user).

6. **Cost basis for purchase grants is the purchase price, not FMV at vest.** For grants with `grant_price > 0`, vesting only lifts the sale restriction — it does not create a new tax event or step up the cost basis. For income/RSU grants (`grant_price = 0`), FMV at vesting is ordinary income and becomes the cost basis.

7. **Down payment shares are non-taxable.** `dp_shares` records vested shares exchanged at exercise. They reduce the loan principal and generate no income or cap gains event. Consumed in lowest-cost-basis order: Bonus (RSU) lots first, then oldest Purchase lots (FIFO).

## Sharing / Email Invitations

Users can invite others by email to **view** (read-only) their financial data.

### Data Model
```
invitations: id, inviter_id, invitee_email, token, short_code, status, invitee_id,
             invitee_account_email, created_at, expires_at, accepted_at,
             last_viewed_at, last_sent_at, notify_enabled
invitation_opt_outs: id, email, created_at
```
- `status`: pending | accepted | declined | revoked
- `token`: URL-safe 48-byte random (base64url) for email links
- `short_code`: 8-char unambiguous alphanumeric (no 0/O/1/I/l) for manual entry
- Tokens expire after 7 days; resend resets the expiry
- One-time use: once `invitee_id` is set, no one else can claim the token

### Flow
1. Inviter enters email → system sends email with link + manual code
2. Invitee clicks link → /invite landing page → sign in with any provider
3. Token carries through OIDC login via sessionStorage
4. After login, auto-accept → redirected to dashboard
5. Manual code entry: Settings → Sharing → "Enter invitation code"

### Viewer Permissions (backend-enforced)
- **Can**: view Dashboard, Events, Grants, Loans, Prices, Sales (all read-only); change "as of" date; export
- **Cannot**: see Tips, use What If (exit date, deduction toggle), create/edit/delete any data
- All shared data served via `/api/sharing/view/{invitation_id}/*` endpoints
- Owner's encryption key is set in ContextVar for each shared-view request

### Multi-user Viewing
- ViewingContext (React) holds "whose data am I viewing"
- Account switcher in header (only visible when user has shared accounts)
- Same pages, different data source — switching doesn't change the current page
- Per-inviter notification toggle (notify_enabled on invitation)
