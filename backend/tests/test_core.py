import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core import (
    generate_exercise_events,
    generate_dp_events,
    generate_vesting_events,
    generate_price_events,
    generate_loan_repayment_events,
    generate_all_events,
    compute_timeline,
    sort_events,
)
from excel_io import read_all_from_excel

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "test_data", "fixture.xlsx")


# ============================================================
# UNIT TESTS — individual generators
# ============================================================

def _make_grant(**overrides):
    base = {
        "year": 2020, "type": "Purchase", "shares": 10000, "price": 1.99,
        "vest_start": datetime(2021, 3, 1), "periods": 5,
        "exercise_date": datetime(2020, 12, 31), "dp_shares": 0,
    }
    base.update(overrides)
    return base


def test_exercise_events_one_per_grant():
    grants = [_make_grant(), _make_grant(year=2021)]
    events = generate_exercise_events(grants)
    assert len(events) == 2
    assert all(e["event_type"] == "Exercise" for e in events)
    assert events[0]["granted_shares"] == 10000


def test_exercise_zero_price_grant():
    g = _make_grant(price=0, type="Bonus")
    events = generate_exercise_events([g])
    assert events[0]["exercise_price"] == 0.0


def test_dp_events_only_nonzero():
    grants = [_make_grant(dp_shares=-500), _make_grant(dp_shares=0)]
    events = generate_dp_events(grants)
    assert len(events) == 1
    assert events[0]["vested_shares"] == -500
    assert events[0]["event_type"] == "Down payment exchange"


def test_vesting_events_count_and_remainder():
    g = _make_grant(shares=7, periods=3)
    events = generate_vesting_events([g])
    assert len(events) == 3
    shares = [e["vested_shares"] for e in events]
    assert shares == [3, 2, 2]  # 7//3=2, remainder=1 → first period gets +1
    assert sum(shares) == 7


def test_vesting_even_split():
    g = _make_grant(shares=10, periods=5)
    events = generate_vesting_events([g])
    assert all(e["vested_shares"] == 2 for e in events)


def test_vesting_single_period():
    g = _make_grant(shares=100, periods=1)
    events = generate_vesting_events([g])
    assert len(events) == 1
    assert events[0]["vested_shares"] == 100


def test_price_events_skip_first():
    prices = [
        {"date": datetime(2020, 12, 31), "price": 1.99},
        {"date": datetime(2021, 3, 1), "price": 2.50},
        {"date": datetime(2022, 3, 1), "price": 3.00},
    ]
    events = generate_price_events(prices)
    assert len(events) == 2
    assert events[0]["price_increase"] == 0.51
    assert events[1]["price_increase"] == 0.50


def test_loan_repayment_events():
    loans = [
        {"due": datetime(2025, 12, 31), "grant_yr": 2020, "loan_type": "Purchase", "amount": 19900.0},
    ]
    events = generate_loan_repayment_events(loans)
    assert len(events) == 1
    assert events[0]["event_type"] == "Loan Repayment"
    assert events[0]["source"]["amount"] == 19900.0


def test_sort_events_by_date_then_type():
    d = datetime(2021, 3, 1)
    events = [
        {"date": d, "event_type": "Vesting", "grant_type": "Purchase", "grant_year": 2020},
        {"date": d, "event_type": "Share Price", "grant_type": None, "grant_year": None},
        {"date": d, "event_type": "Exercise", "grant_type": "Purchase", "grant_year": 2020},
    ]
    sorted_e = sort_events(events)
    types = [e["event_type"] for e in sorted_e]
    assert types == ["Share Price", "Exercise", "Vesting"]


# ============================================================
# COMPUTE TIMELINE — simple cases
# ============================================================

def test_compute_timeline_vesting_income():
    """Zero-cost-basis vesting → income, not cap gains."""
    events = [{
        "date": datetime(2021, 3, 1), "grant_year": 2020, "grant_type": "Bonus",
        "event_type": "Vesting", "granted_shares": None, "grant_price": 0,
        "exercise_price": None, "vested_shares": 100, "price_increase": 0.0,
        "source": {"type": "grant", "index": 0},
    }]
    timeline = compute_timeline(events, initial_price=5.0)
    assert len(timeline) == 1
    row = timeline[0]
    assert row["income"] == 500.0  # 100 * 5.0
    assert row["cum_income"] == 500.0
    assert row["total_cap_gains"] == 0.0


def test_compute_timeline_vesting_cap_gains():
    """Positive-cost-basis vesting → cap gains, not income."""
    events = [{
        "date": datetime(2021, 3, 1), "grant_year": 2020, "grant_type": "Purchase",
        "event_type": "Vesting", "granted_shares": None, "grant_price": 1.99,
        "exercise_price": None, "vested_shares": 1000, "price_increase": 0.0,
        "source": {"type": "grant", "index": 0},
    }]
    timeline = compute_timeline(events, initial_price=5.0)
    row = timeline[0]
    assert row["income"] == 0.0
    assert row["vesting_cap_gains"] == (5.0 - 1.99) * 1000


def test_compute_timeline_price_increase_cap_gains():
    """Price increase generates cap gains based on prior cum_shares."""
    events = [
        {"date": datetime(2021, 1, 1), "grant_year": 2020, "grant_type": "Bonus",
         "event_type": "Vesting", "granted_shares": None, "grant_price": 0,
         "exercise_price": None, "vested_shares": 100, "price_increase": 0.0,
         "source": {"type": "grant", "index": 0}},
        {"date": datetime(2022, 3, 1), "grant_year": None, "grant_type": None,
         "event_type": "Share Price", "granted_shares": None, "grant_price": None,
         "exercise_price": None, "vested_shares": None, "price_increase": 1.0,
         "source": {"type": "price", "index": 1, "prev_index": 0}},
    ]
    timeline = compute_timeline(events, initial_price=5.0)
    assert timeline[1]["price_cap_gains"] == 100.0  # 1.0 increase * 100 shares


def test_compute_timeline_loan_repayment():
    """Loan repayment sells shares (negative vested_shares)."""
    import math
    events = [
        {"date": datetime(2021, 1, 1), "grant_year": 2020, "grant_type": "Bonus",
         "event_type": "Vesting", "granted_shares": None, "grant_price": 0,
         "exercise_price": None, "vested_shares": 1000, "price_increase": 0.0,
         "source": {"type": "grant", "index": 0}},
        {"date": datetime(2025, 12, 31), "grant_year": 2020, "grant_type": "Purchase",
         "event_type": "Loan Repayment", "granted_shares": None, "grant_price": None,
         "exercise_price": None, "vested_shares": None, "price_increase": 0.0,
         "source": {"type": "loan", "index": 0, "amount": 500.0}},
    ]
    timeline = compute_timeline(events, initial_price=5.0)
    sold = -math.ceil(500.0 / 5.0)  # -100
    assert timeline[1]["vested_shares"] == sold
    assert timeline[1]["cum_shares"] == 1000 + sold


# ============================================================
# FIXTURE INTEGRATION — known-good values
# ============================================================

def test_fixture_event_count():
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    events = generate_all_events(grants, prices, loans)
    assert len(events) == 89


def test_fixture_timeline_totals():
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)
    last = timeline[-1]
    assert last["cum_shares"] == 269843
    assert last["cum_income"] == 144325.0
    assert last["cum_cap_gains"] == 1243695.0


def test_fixture_timeline_share_price_chain():
    """Share price should monotonically build from initial + all price_increases."""
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)
    expected_final_price = initial_price + sum(e["price_increase"] for e in events)
    assert timeline[-1]["share_price"] == round(expected_final_price, 2)


def test_fixture_events_sorted_chronologically():
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    events = generate_all_events(grants, prices, loans)
    dates = [e["date"] for e in events]
    assert dates == sorted(dates)


def test_fixture_grant_counts():
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    assert len(grants) == 12
    assert len(prices) == 8
    assert len(loans) == 21


# ============================================================
# EDGE CASES
# ============================================================

def test_empty_inputs():
    events = generate_all_events([], [], [])
    assert events == []
    timeline = compute_timeline(events, 1.0)
    assert timeline == []


def test_grants_only_no_prices_no_loans():
    g = _make_grant()
    events = generate_all_events([g], [{"date": datetime(2020, 12, 31), "price": 1.99}], [])
    # Exercise + 5 vesting events, no price events (only 1 price), no loans
    assert len(events) == 6
    types = {e["event_type"] for e in events}
    assert types == {"Exercise", "Vesting"}
