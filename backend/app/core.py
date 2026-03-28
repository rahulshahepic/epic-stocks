"""
Core event generation — pure functions, no I/O dependencies.
Operates on plain dicts. Drop into any app.
"""
from datetime import datetime
from dateutil.relativedelta import relativedelta


_TYPE_ORDER = {
    'Share Price': 0, 'Exercise': 1, 'Down payment exchange': 2,
    'Vesting': 3, 'Loan Payoff': 4,
}
_LOAN_TYPE_ORDER = {'Purchase': 0, 'Interest': 1, 'Tax': 2}


# ============================================================
# EVENT GENERATORS
# ============================================================

def generate_exercise_events(grants):
    """One exercise event per grant."""
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
    """Down payment exchange events for grants with dp_shares != 0."""
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
    """One vesting event per grant x period."""
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
    """Share price change events (one per price point after the first)."""
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


def generate_loan_payoff_events(loans):
    """One payoff event per loan — cash obligation, no auto share sale."""
    return [{
        'date': loan['due'],
        'grant_year': loan['grant_yr'],
        'grant_type': loan['loan_type'],
        'event_type': 'Loan Payoff',
        'granted_shares': None,
        'grant_price': None,
        'exercise_price': None,
        'vested_shares': None,
        'price_increase': 0.0,
        'source': {'type': 'loan', 'index': i, 'amount': loan['amount']},
    } for i, loan in enumerate(loans)]


# Backward-compat alias (tests and callers may still use old name)
generate_loan_repayment_events = generate_loan_payoff_events


# ============================================================
# SORTING
# ============================================================

def sort_events(events):
    """Chronological, then by event type, then by grant details."""
    def key(e):
        return (
            e['date'],
            _TYPE_ORDER.get(e['event_type'], 5),
            _LOAN_TYPE_ORDER.get(e['grant_type'], 5),
            e['grant_year'] or 9999,
            e['grant_type'] or 'ZZZ',
        )
    return sorted(events, key=key)


# ============================================================
# FULL PIPELINE
# ============================================================

def generate_all_events(grants, prices, loans):
    """Source data in, sorted event list out."""
    events = (
        generate_exercise_events(grants)
        + generate_dp_events(grants)
        + generate_vesting_events(grants)
        + generate_price_events(prices)
        + generate_loan_payoff_events(loans)
    )
    return sort_events(events)


# ============================================================
# DERIVED CALCULATIONS (for display / validation)
# ============================================================

def compute_timeline(events, initial_price):
    """
    Walk sorted events, compute running totals per row.
    Returns enriched event list with share_price, cum_shares,
    income, cum_income, vesting_cap_gains, price_cap_gains,
    total_cap_gains, cum_cap_gains.
    """
    price = initial_price
    cum_shares = 0
    cum_income = 0.0
    cum_cap_gains = 0.0
    result = []

    for e in events:
        prev_cum_shares = cum_shares
        price += e['price_increase']

        vs = e['vested_shares'] or 0
        # Loan Payoff events are cash obligations — no auto share sale.
        # Shares are only reduced when the user explicitly records a Sale.

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
