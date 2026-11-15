"""Unbooked interest and tax loans: payoffs, the exit, the deduction and 83(b).

Each scenario mirrors a reported account, with invented round figures in
place of real ones (loan principals encode Epic's share prices, which never
appear in this repo). Accrual is actual/365 from the disbursement date; each
31 December's unpaid interest becomes an Interest loan at the assumed rate,
due with the grant's purchase loan; a group's first partial year rolls into
the next 31 December, as Epic's statements do.
"""
import math
import os
import sys
from datetime import date

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.loan_projection import project, outstanding_at_stop, assumed_rate_from
from tests.conftest import register_user


def _days(a, b):
    return (b - a).days


def _loan(id, gy, gt, lt, ly, amount, rate, due, disbursed=None, ref=None):
    return {"id": id, "grant_year": gy, "grant_type": gt, "loan_type": lt, "loan_year": ly,
            "amount": amount, "interest_rate": rate, "due_date": due, "disbursed_on": disbursed,
            "refinances_loan_id": ref}


def _grant(year, gtype, shares, price, exercise, vesting, e83=True):
    from datetime import datetime
    dt = lambda d: datetime.combine(d, datetime.min.time())
    return {"year": year, "type": gtype, "shares": shares, "price": price,
            "exercise_date": dt(exercise), "vesting": [(dt(d), n) for d, n in vesting],
            "dp_shares": 0, "election_83b": e83}


def _prices(*pairs):
    from datetime import datetime
    return [{"date": datetime(y, 1, 1), "price": p} for y, p in pairs]


# ── 1. interest on loans repaid before the exit ─────────────────────────────

def _group_2022():
    """A 2022 purchase loan with three booked Interest rows, due 2031-06-30."""
    due = date(2031, 6, 30)
    return [
        _loan(1, 2022, "Purchase", "Purchase", 2022, 400_000.0, 0.02, due, date(2022, 6, 30)),
        _loan(2, 2022, "Purchase", "Interest", 2023, 11_000.0, 0.044, due),
        _loan(3, 2022, "Purchase", "Interest", 2024, 8_000.0, 0.037, due),
        _loan(4, 2022, "Purchase", "Interest", 2025, 8_300.0, 0.038, due),
    ]


def _expected_2022(rate=0.038, through=date(2031, 6, 30)):
    """Independent arithmetic: 2026-2030 capitalised, 2031 accrual paid at payoff."""
    real = [(400_000.0, 0.02), (11_000.0, 0.044), (8_000.0, 0.037), (8_300.0, 0.038)]
    capitalised = []
    for year in range(2026, through.year):
        days = _days(date(year, 1, 1), date(year + 1, 1, 1))
        interest = sum(a * r * days / 365 for a, r in real) + sum(c * rate * days / 365 for c in capitalised)
        capitalised.append(interest)
    stub = _days(date(through.year, 1, 1), through)
    accrued = sum(a * r * stub / 365 for a, r in real) + sum(c * rate * stub / 365 for c in capitalised)
    return sum(capitalised), accrued


def test_payoff_carries_interest_projected_to_its_own_due_date():
    """The 2031-06-30 payoff owed principal and booked rows only — exactly the
    last statement — with five more years of interest left out."""
    proj = project(_group_2022(), [], [], today=date(2026, 11, 15), assumed_rate=0.038)
    capitalised, accrued = _expected_2022()
    po = proj.payoff_for(1)
    assert po.date == date(2031, 6, 30)
    assert po.projected_interest == pytest.approx(capitalised, abs=0.05)
    assert po.accrued == pytest.approx(accrued, abs=0.05)
    assert proj.extra_for(1) == pytest.approx(capitalised + accrued, abs=0.1)
    assert [p.loan_year for p in proj.projected] == [2026, 2027, 2028, 2029, 2030]
    assert all(p.due == date(2031, 6, 30) for p in proj.projected)


def test_a_booked_statement_replaces_the_projection_rather_than_adding_to_it():
    loans = _group_2022()
    before = project(loans, [], [], today=date(2026, 11, 15), assumed_rate=0.038)
    booked = loans + [_loan(5, 2022, "Purchase", "Interest", 2026, 8_600.0, 0.038, date(2031, 6, 30))]
    after = project(booked, [], [], today=date(2026, 11, 15), assumed_rate=0.038)
    assert [p.loan_year for p in after.projected] == [2027, 2028, 2029, 2030]
    # The real 2026 row is paid on its own payoff event, so the anchor's extra
    # drops by about what the projected 2026 row was — not by nothing.
    proj_2026 = next(p.amount for p in before.projected if p.loan_year == 2026)
    assert before.extra_for(1) - after.extra_for(1) == pytest.approx(proj_2026, rel=0.05)


def test_a_group_with_interest_rows_still_has_its_catch_up_tax_interest_projected():
    """Epic books a Catch-Up grant's tax-loan interest into the Purchase
    grant's annual Interest loan, so it is projected there too."""
    loans = _group_2022() + [_loan(9, 2022, "Catch-Up", "Tax", 2026, 10_000.0, 0.035,
                                   date(2031, 6, 30), date(2026, 6, 15))]
    proj = project(loans, [], [], today=date(2026, 11, 15), assumed_rate=0.038)
    alone = project(_group_2022(), [], [], today=date(2026, 11, 15), assumed_rate=0.038)
    first = next(p for p in proj.projected if p.loan_year == 2026)
    assert first.grant_type == "Purchase"
    extra_2026 = 10_000 * 0.035 * _days(date(2026, 6, 15), date(2027, 1, 1)) / 365
    assert first.amount - next(p.amount for p in alone.projected if p.loan_year == 2026) == pytest.approx(extra_2026, abs=0.05)


PURCHASE_2030 = {"year": 2030, "type": "Purchase", "shares": 100_000, "price": 2.0,
                 "vest_start": "2031-09-30", "periods": 2, "exercise_date": "2030-06-30",
                 "dp_shares": 0, "election_83b": True}


def _api_account(client, withholding=None):
    register_user(client)
    client.post("/api/grants", json=PURCHASE_2030)
    for y, p in ((2030, 2.0), (2035, 4.0), (2040, 5.0)):
        client.post("/api/prices", json={"effective_date": f"{y}-01-01", "price": p})
    if withholding is not None:
        client.put("/api/tax-settings", json={"tax_withholding_rate": withholding})
    r = client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2030, "grant_type": "Purchase", "loan_type": "Purchase", "loan_year": 2030,
        "amount": 100_000.0, "interest_rate": 0.04, "due_date": "2039-06-30",
        "disbursed_on": "2030-06-30"})
    assert r.status_code == 201, r.text
    return r.json()


def test_payoff_event_and_payoff_sale_owe_the_projected_interest(client):
    loan = _api_account(client)
    assert loan["disbursed_on"] == "2030-06-30"
    event = next(e for e in client.get("/api/events").json()
                 if e["event_type"] == "Loan Payoff" and e.get("loan_db_id") == loan["id"])
    # Stub 2030 rolls into 2031; 2031-2038 capitalised at 4% (the only rate on
    # record); 2039 accrues to 30 June and is paid with the loan.
    caps = [100_000 * 0.04 * (_days(date(2030, 6, 30), date(2031, 1, 1)) + 365) / 365]
    for year in range(2032, 2039):
        caps.append((100_000 + sum(caps)) * 0.04 * _days(date(year, 1, 1), date(year + 1, 1, 1)) / 365)
    owed = sum(caps) + (100_000 + sum(caps)) * 0.04 * _days(date(2039, 1, 1), date(2039, 6, 30)) / 365
    assert event["cash_due"] == pytest.approx(100_000 + owed, abs=0.5)
    assert event["projected_interest"] + event["projected_accrued_interest"] == pytest.approx(owed, abs=0.5)

    suggestion = client.get(f"/api/loans/{loan['id']}/payoff-sale-suggestion").json()
    assert suggestion["cash_due"] == pytest.approx(event["cash_due"], abs=0.01)
    sale = next(s for s in client.get("/api/sales").json() if s["loan_id"] == loan["id"])
    # More shares than the principal alone needs at $5.
    assert sale["shares"] > math.ceil(100_000 / 5.0)


# ── 2. tax on zero-basis vests ──────────────────────────────────────────────

def test_a_zero_basis_vest_projects_a_tax_loan_paid_like_any_other():
    """60,000 Free shares vesting 2027-09-30 at $10: income of $600,000 and,
    with no real Tax loan, a projected $312,000 one due 2031-06-30."""
    grants = [_grant(2022, "Free", 60_000, 0.0, date(2022, 12, 31), [(date(2027, 9, 30), 60_000)], e83=False)]
    proj = project(_group_2022(), grants, _prices((2026, 8.0), (2027, 10.0)), today=date(2026, 11, 15),
                   assumed_rate=0.038, tax_due_dates={(2022, "Free"): date(2031, 6, 30)})
    tax = [p for p in proj.projected if p.loan_type == "Tax"]
    assert len(tax) == 1
    assert tax[0].amount == pytest.approx(312_000.0)
    assert tax[0].due == date(2031, 6, 30) and tax[0].accrue_from == date(2027, 9, 30)
    po = proj.payoff_for(1)
    assert po.projected_principal == pytest.approx(312_000.0)
    # Its interest is capitalised with the grant year's other loans.
    with_tax = sum(p.amount for p in proj.projected if p.loan_type == "Interest")
    without = sum(p.amount for p in project(_group_2022(), [], [], today=date(2026, 11, 15),
                                            assumed_rate=0.038).projected)
    caps = [312_000 * 0.038 * _days(date(2027, 9, 30), date(2028, 1, 1)) / 365]
    for y in range(2028, 2031):
        caps.append((312_000 + sum(caps)) * 0.038 * _days(date(y, 1, 1), date(y + 1, 1, 1)) / 365)
    assert with_tax - without == pytest.approx(sum(caps), abs=0.05)


def test_a_real_tax_loan_for_that_vest_year_replaces_the_projection():
    grants = [_grant(2022, "Free", 60_000, 0.0, date(2022, 12, 31), [(date(2027, 9, 30), 60_000)], e83=False)]
    loans = _group_2022() + [_loan(7, 2022, "Free", "Tax", 2027, 300_000.0, 0.035, date(2031, 6, 30))]
    proj = project(loans, grants, _prices((2027, 10.0)), today=date(2026, 11, 15), assumed_rate=0.038,
                   tax_due_dates={(2022, "Free"): date(2031, 6, 30)})
    assert not [p for p in proj.projected if p.loan_type == "Tax"]


def test_withholding_is_a_setting_with_a_052_default(client):
    register_user(client)
    assert client.get("/api/tax-settings").json()["tax_withholding_rate"] is None
    grants = [_grant(2022, "Free", 1_000, 0.0, date(2022, 12, 31), [(date(2027, 9, 30), 1_000)], e83=False)]
    default = project([], grants, _prices((2027, 10.0)), today=date(2026, 1, 1),
                      tax_due_dates={(2022, "Free"): date(2031, 6, 30)})
    assert default.projected[0].amount == pytest.approx(5_200.0)
    r = client.put("/api/tax-settings", json={"tax_withholding_rate": 0.515})
    assert r.json()["tax_withholding_rate"] == 0.515


def test_a_future_free_vest_shows_its_tax_loan_on_the_timeline(client):
    register_user(client)
    client.post("/api/grants", json={"year": 2034, "type": "Free", "shares": 1_000, "price": 0.0,
                                     "vest_start": "2039-09-30", "periods": 1,
                                     "exercise_date": "2034-12-31", "dp_shares": 0})
    client.post("/api/prices", json={"effective_date": "2034-01-01", "price": 10.0})
    events = client.get("/api/events").json()
    vest = next(e for e in events if e["event_type"] == "Vesting")
    assert vest["income"] == 10_000.0
    # No loan of its own and no company due date for a 2034 Free grant: the
    # projected loan has nothing to be due with, so nothing is invented.
    payoffs = [e for e in events if e["event_type"] == "Loan Payoff"]
    assert payoffs == []


# ── 3. the exit's accrued interest ──────────────────────────────────────────

def test_exit_accrues_from_the_disbursement_date_and_compounds_each_31_december():
    """A 2025 loan disbursed 30 September, nothing booked yet: the 2025 stub
    rolls into 31 December 2026, every later year is capitalised at the
    assumed rate, and the exit pays all of it plus accrual to the exit."""
    loans = [_loan(1, 2025, "Purchase", "Purchase", 2025, 2_000_000.0, 0.04, date(2034, 6, 30),
                   date(2025, 9, 30))]
    stop = date(2031, 10, 1)
    out = outstanding_at_stop(project(loans, [], [], today=date(2026, 11, 15), stop=stop, assumed_rate=0.038))
    caps = []
    first = 2_000_000 * 0.04 * _days(date(2025, 9, 30), date(2027, 1, 1)) / 365
    caps.append(first)
    for year in range(2027, 2031):
        d = _days(date(year, 1, 1), date(year + 1, 1, 1))
        caps.append(2_000_000 * 0.04 * d / 365 + sum(caps) * 0.038 * d / 365)
    d = _days(date(2031, 1, 1), stop)
    accrued = 2_000_000 * 0.04 * d / 365 + sum(caps) * 0.038 * d / 365
    assert out["projected_interest"] == pytest.approx(sum(caps), abs=0.05)
    assert out["accrued"] == pytest.approx(accrued, abs=0.05)


def test_without_a_disbursement_date_accrual_starts_at_exercise():
    grants = [_grant(2025, "Purchase", 1, 1.0, date(2025, 7, 25), [(date(2026, 9, 30), 1)])]
    loans = [_loan(1, 2025, "Purchase", "Purchase", 2025, 1_000_000.0, 0.04, date(2034, 6, 30))]
    inferred = project(loans, grants, [], today=date(2026, 1, 1), stop=date(2025, 12, 31))
    assert outstanding_at_stop(inferred)["accrued"] == pytest.approx(
        1_000_000 * 0.04 * _days(date(2025, 7, 25), date(2025, 12, 31)) / 365, abs=0.01)
    loans[0]["disbursed_on"] = date(2025, 9, 30)
    stated = project(loans, grants, [], today=date(2026, 1, 1), stop=date(2025, 12, 31))
    assert outstanding_at_stop(stated)["accrued"] == pytest.approx(
        1_000_000 * 0.04 * _days(date(2025, 9, 30), date(2025, 12, 31)) / 365, abs=0.01)


def test_a_booked_group_accrues_from_1_january_after_its_last_statement():
    loans = [_loan(1, 2023, "Purchase", "Purchase", 2023, 600_000.0, 0.035, date(2032, 6, 30), date(2023, 8, 31)),
             _loan(2, 2023, "Purchase", "Interest", 2025, 22_000.0, 0.038, date(2032, 6, 30))]
    out = outstanding_at_stop(project(loans, [], [], today=date(2026, 1, 1), stop=date(2026, 11, 15)))
    d = _days(date(2026, 1, 1), date(2026, 11, 15))
    assert out["accrued"] == pytest.approx((600_000 * 0.035 + 22_000 * 0.038) * d / 365, abs=0.01)


def test_the_assumed_rate_defaults_to_the_latest_interest_loan_rate():
    assert assumed_rate_from(_group_2022()) == 0.038
    loans = _group_2022()
    a = project(loans, [], [], today=date(2026, 1, 1))
    b = project(loans, [], [], today=date(2026, 1, 1), assumed_rate=0.05)
    assert a.assumed_rate == 0.038 and all(p.rate == 0.05 for p in b.projected)


def test_settings_and_disbursement_round_trip(client):
    register_user(client)
    r = client.put("/api/tax-settings", json={"projected_loan_rate": 0.038, "exit_payoff_lag_days": 30})
    assert r.status_code == 200, r.text
    assert r.json()["projected_loan_rate"] == 0.038 and r.json()["exit_payoff_lag_days"] == 30
    assert client.put("/api/tax-settings", json={"exit_payoff_lag_days": 400}).status_code == 422
    assert client.put("/api/tax-settings", json={"projected_loan_rate": 3.8}).status_code == 422


def test_payoff_lag_keeps_interest_running_after_the_exit(client):
    _api_account(client)
    base = client.get("/api/preview-exit?date=2036-10-01").json()
    client.put("/api/tax-settings", json={"exit_payoff_lag_days": 30})
    lagged = client.get("/api/preview-exit?date=2036-10-01").json()
    assert lagged["outstanding_accrued_interest"] > base["outstanding_accrued_interest"]
    assert lagged["net_cash"] < base["net_cash"]


def test_dashboard_and_exit_use_the_same_accrual(client):
    _api_account(client)
    today = date.today().isoformat()
    dash = client.get("/api/dashboard").json()
    exit_today = client.get(f"/api/preview-exit?date={today}").json()
    if exit_today:  # needs shares to liquidate
        assert dash["accrued_unbooked_interest"] == exit_today["outstanding_accrued_interest"]


# ── 4. 83(b), the deduction ────────────────────────────────────────────────

GRANT_83 = {"year": 2020, "type": "Purchase", "shares": 1000, "price": 10.0,
            "vest_start": "2021-01-01", "periods": 2, "exercise_date": "2020-01-01", "dp_shares": 0}
FREE_83 = {"year": 2020, "type": "Free", "shares": 1000, "price": 0.0,
           "vest_start": "2021-01-01", "periods": 2, "exercise_date": "2020-01-01", "dp_shares": 0}


def _toggle_account(client, e83, grant=GRANT_83):
    register_user(client)
    gid = client.post("/api/grants", json={**grant, "election_83b": e83}).json()["id"]
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    client.post("/api/prices", json={"effective_date": "2021-01-01", "price": 15.0})
    client.post("/api/prices", json={"effective_date": "2022-01-01", "price": 20.0})
    client.post("/api/sales", json={"date": "2022-03-01", "shares": 500, "price_per_share": 20.0})
    return gid


@pytest.mark.parametrize("flag", [True, False])
def test_a_purchase_is_always_taxed_as_an_83b(client, flag):
    """Epic requires an 83(b) with every purchase, so the flag changes
    nothing: no income or gain at vest, basis is the price paid, held from
    exercise."""
    _toggle_account(client, flag)
    vests = [e for e in client.get("/api/events").json() if e["event_type"] == "Vesting"]
    assert all(e["income"] == 0 and e["vesting_cap_gains"] == 0 for e in vests)
    sale = next(s for s in client.get("/api/sales").json())
    tax = client.get(f"/api/sales/{sale['id']}/tax").json()
    assert tax["cost_basis"] == 5_000.0 and tax["lt_shares"] == 500 and tax["st_shares"] == 0


def test_a_free_grant_without_83b_is_income_at_each_vest(client):
    _toggle_account(client, False, FREE_83)
    events = client.get("/api/events").json()
    assert [e["income"] for e in events if e["event_type"] == "Vesting"] == [7_500.0, 10_000.0]
    assert next(e for e in events if e["event_type"] == "Exercise")["income"] == 0
    sale = next(s for s in client.get("/api/sales").json())
    tax = client.get(f"/api/sales/{sale['id']}/tax").json()
    # LIFO takes the 2022-01-01 lot: basis $20, held from vest, so short-term.
    assert tax["cost_basis"] == 10_000.0 and tax["st_shares"] == 500


def test_a_free_grant_with_83b_is_income_at_grant(client):
    """The election pays tax on the value at grant ($10 x 1,000) instead of at
    each vest; that value is the basis and the holding period starts then."""
    _toggle_account(client, True, FREE_83)
    events = client.get("/api/events").json()
    assert next(e for e in events if e["event_type"] == "Exercise")["income"] == 10_000.0
    assert all(e["income"] == 0 for e in events if e["event_type"] == "Vesting")
    sale = next(s for s in client.get("/api/sales").json())
    tax = client.get(f"/api/sales/{sale['id']}/tax").json()
    assert tax["cost_basis"] == 5_000.0 and tax["lt_shares"] == 500


def test_toggling_83b_on_a_free_grant_changes_the_figures(client):
    gid = _toggle_account(client, False, FREE_83)
    client.put("/api/tax-settings", json={"lt_holding_days": 365})  # persist the account's rates
    sid = client.get("/api/sales").json()[0]["id"]
    before = client.get("/api/dashboard").json()
    tax_before = client.get(f"/api/sales/{sid}/tax").json()["estimated_tax"]
    g = client.get(f"/api/grants/{gid}").json()
    client.put(f"/api/grants/{gid}", json={"election_83b": True, "version": g["version"]})
    after = client.get("/api/dashboard").json()
    tax_after = client.get(f"/api/sales/{sid}/tax").json()["estimated_tax"]
    assert (before["total_income"], after["total_income"]) == (17_500.0, 10_000.0)
    assert tax_before == 0 and tax_after > 0  # $20 basis vs $10 basis
    assert before["total_tax_paid"] != after["total_tax_paid"]


def test_an_83b_free_grant_projects_no_tax_loan_at_vest():
    grants = [_grant(2022, "Free", 60_000, 0.0, date(2022, 12, 31), [(date(2027, 9, 30), 60_000)], e83=True)]
    proj = project(_group_2022(), grants, _prices((2027, 10.0)), today=date(2026, 11, 15),
                   assumed_rate=0.038, tax_due_dates={(2022, "Free"): date(2031, 6, 30)})
    assert not [p for p in proj.projected if p.loan_type == "Tax"]


def test_down_payment_shares_carry_their_basis_into_the_new_grant(client):
    """100 shares bought at $1 and worth $10 are exchanged toward a $10 grant
    of 1,000 shares: the $900 gain is deferred, so the new lots' basis is
    $10 - $0.90."""
    register_user(client)
    client.post("/api/grants", json={"year": 2018, "type": "Purchase", "shares": 100, "price": 1.0,
                                     "vest_start": "2019-01-01", "periods": 1,
                                     "exercise_date": "2018-01-01", "dp_shares": 0, "election_83b": True})
    client.post("/api/grants", json={"year": 2020, "type": "Purchase", "shares": 1000, "price": 10.0,
                                     "vest_start": "2021-01-01", "periods": 1,
                                     "exercise_date": "2020-06-01", "dp_shares": -100, "election_83b": True})
    client.post("/api/prices", json={"effective_date": "2018-01-01", "price": 1.0})
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    client.post("/api/prices", json={"effective_date": "2022-01-01", "price": 20.0})
    sid = client.post("/api/sales", json={"date": "2022-03-01", "shares": 1000,
                                          "price_per_share": 20.0}).json()["id"]
    tax = client.get(f"/api/sales/{sid}/tax").json()
    assert tax["cost_basis"] == pytest.approx(9_100.0)


def test_exit_deducts_interest_paid_by_then_against_realized_gains(client):
    _api_account(client)
    client.put("/api/tax-settings", json={"deduct_investment_interest": True})
    ex = client.get("/api/preview-exit?date=2036-10-01").json()
    ts = client.get("/api/tax-settings").json()
    lt = ts["federal_lt_cg_rate"] + ts["niit_rate"] + ts["state_lt_cg_rate"]
    # All interest is paid at the exit, against long-term gains on the liquidation.
    assert ex["interest_deducted"] == pytest.approx(ex["interest_paid_through_exit"], abs=0.01)
    assert ex["deduction_savings"] == pytest.approx(ex["interest_deducted"] * lt, abs=0.05)
    assert ex["deduction_years"] == [2036]


def test_dashboard_claims_no_savings_before_anything_is_sold(client):
    _api_account(client)
    client.put("/api/tax-settings", json={"deduct_investment_interest": True})
    dash = client.get("/api/dashboard").json()
    assert dash["tax_savings_from_deduction"] == 0


# ── 5. bonus schedule, past-due payoffs ────────────────────────────────────

def test_a_three_year_bonus_vests_34_33_and_the_rest():
    from services.vesting import default_split
    rows = default_split("Bonus", 2023, 1001, date(2024, 9, 30), 3)
    assert [n for _, n in rows] == [340, 330, 331]
    assert [n for _, n in default_split("Purchase", 2023, 1001, date(2024, 9, 30), 3)] == [333, 333, 335]
    assert [n for _, n in default_split("Bonus", 2020, 1000, date(2021, 9, 30), 4)] == [250, 250, 250, 250]


def test_add_bonus_uses_the_agreement_split(client):
    register_user(client)
    r = client.post("/api/flows/add-bonus", json={"year": 2023, "shares": 10_000, "price": 3.0,
                                                  "vest_start": "2024-09-30", "periods": 3,
                                                  "exercise_date": "2023-12-31", "election_83b": True})
    assert [v["shares"] for v in r.json()["vesting"]] == [3_400, 3_300, 3_300]


def test_a_past_due_payoff_is_not_settled_automatically(client):
    register_user(client)
    client.post("/api/grants", json={**GRANT_83, "election_83b": True})
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    r = client.post("/api/loans?generate_payoff_sale=true", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Tax", "loan_year": 2021,
        "amount": 1_000.0, "interest_rate": 0.01, "due_date": "2025-07-15"})
    assert r.status_code == 201
    assert client.get("/api/sales").json() == []
    event = next(e for e in client.get("/api/events").json() if e["event_type"] == "Loan Payoff")
    assert event["status"] == "past_due_unconfirmed"
    # Confirming it is explicit, and sells today.
    sale = client.post(f"/api/loans/{r.json()['id']}/execute-payoff").json()
    assert sale["date"] == date.today().isoformat()


# ── review follow-ups ───────────────────────────────────────────────────────

def _purchase_2020(**kw):
    return _loan(1, 2020, "Purchase", "Purchase", 2020, 100_000.0, 0.05, date(2032, 12, 31),
                 date(2020, 1, 1), **kw)


def test_a_refinance_keeps_the_interest_of_the_years_before_it():
    """Refinanced in 2028: 2026 and 2027 still accrue on the old loan."""
    booked = _loan(2, 2020, "Purchase", "Interest", 2025, 5_000.0, 0.05, date(2032, 12, 31))
    plain = project([_purchase_2020(), booked], [], [], today=date(2026, 1, 1), assumed_rate=0.05)
    refi = project([_purchase_2020(), booked,
                    _loan(3, 2020, "Purchase", "Purchase", 2028, 100_000.0, 0.05, date(2032, 12, 31), ref=1)],
                   [], [], today=date(2026, 1, 1), assumed_rate=0.05)
    rows = lambda p: {x.loan_year: x.amount for x in p.projected if x.loan_type == "Interest"}
    assert rows(refi)[2026] == pytest.approx(rows(plain)[2026]) == pytest.approx(5_250.0)
    assert rows(refi)[2027] == pytest.approx(rows(plain)[2027])
    assert rows(refi)[2030] == pytest.approx(rows(plain)[2030], abs=0.01)
    # The old row is never paid out on its own.
    assert refi.payoff_for(1) is None


def test_a_past_due_unconfirmed_loan_keeps_accruing_to_the_exit():
    loan = _loan(1, 2020, "Purchase", "Purchase", 2025, 100_000.0, 0.05, date(2026, 1, 1), date(2025, 1, 1))
    stop = date(2026, 12, 1)
    proj = project([loan], [], [], today=date(2026, 11, 15), stop=stop, assumed_rate=0.05)
    out = outstanding_at_stop(proj)
    # 2025 capitalised on 31 December; 2026 accrues to the exit.
    assert out["projected_interest"] == pytest.approx(5_000.0, abs=0.01)
    assert out["accrued"] == pytest.approx(105_000 * 0.05 * _days(date(2026, 1, 1), stop) / 365, abs=0.01)
    # Nothing is "paid" on the old due date: it is all paid at the exit.
    assert set(proj.interest_paid_by_year()) == {2026}
    assert [p.date for p in proj.payoffs] == [stop]


def test_a_confirmed_payoff_of_a_past_due_loan_owes_interest_to_the_confirmation(client):
    register_user(client)
    client.post("/api/grants", json={**GRANT_83, "election_83b": True})
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    loan = client.post("/api/loans?generate_payoff_sale=false", json={
        "grant_year": 2020, "grant_type": "Purchase", "loan_type": "Purchase", "loan_year": 2020,
        "amount": 1_000.0, "interest_rate": 0.05, "due_date": "2025-07-15",
        "disbursed_on": "2020-01-01"}).json()
    at_due = client.get(f"/api/loans/{loan['id']}/payoff-sale-suggestion?payoff_date=2025-07-15").json()
    now = client.get(f"/api/loans/{loan['id']}/payoff-sale-suggestion?payoff_date={date.today()}").json()
    assert now["cash_due"] > at_due["cash_due"] > 1_000


def test_a_snapshot_ignores_interest_rows_booked_after_it():
    later = _loan(2, 2020, "Purchase", "Interest", 2025, 1.0, 0.05, date(2032, 12, 31))
    stop = date(2024, 6, 1)
    without = outstanding_at_stop(project([_purchase_2020()], [], [], today=date(2026, 1, 1), stop=stop))
    with_row = outstanding_at_stop(project([_purchase_2020(), later], [], [], today=date(2026, 1, 1), stop=stop))
    assert without == with_row
    assert without["projected_interest"] + without["accrued"] > 20_000


def test_a_snapshot_ignores_a_refinance_from_a_later_year():
    stop = date(2024, 6, 1)
    refi = _loan(3, 2020, "Purchase", "Purchase", 2025, 100_000.0, 0.05, date(2032, 12, 31), ref=1)
    a = outstanding_at_stop(project([_purchase_2020()], [], [], today=date(2026, 1, 1), stop=stop))
    b = outstanding_at_stop(project([_purchase_2020(), refi], [], [], today=date(2026, 1, 1), stop=stop))
    assert a == b


def test_an_early_payoff_repays_only_its_own_loan():
    due = date(2032, 12, 31)
    loans = [_purchase_2020(), _loan(4, 2020, "Catch-Up", "Tax", 2024, 50_000.0, 0.04, due, date(2024, 6, 15))]
    stop = date(2026, 6, 30)
    proj = project(loans, [], [], today=date(2026, 6, 30), stop=stop, assumed_rate=0.05)
    extra = proj.early_payoff_extra(1)
    group = proj.payoff_for(1).extra
    tax_accrual = proj.accrued_by_key["loan:4"]
    assert tax_accrual > 0
    assert extra == pytest.approx(group - tax_accrual, abs=0.02)


def test_a_purchase_bought_off_the_days_price_shows_the_difference_at_exercise(client):
    register_user(client)
    client.post("/api/grants", json={**GRANT_83, "price": 8.0, "election_83b": True})
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 10.0})
    ex = next(e for e in client.get("/api/events").json() if e["event_type"] == "Exercise")
    assert ex["vesting_cap_gains"] == 2_000.0 and ex["income"] == 0


def test_stale_generated_payoff_sales_are_resized_once(client, db_session):
    from app.routers.loans import resize_generated_payoff_sales
    from scaffold.models import Sale
    loan = _api_account(client)
    sale = next(s for s in client.get("/api/sales").json() if s["loan_id"] == loan["id"])
    right = sale["shares"]
    mine = client.post("/api/sales", json={"date": "2038-01-01", "shares": 7, "price_per_share": 5.0}).json()
    from scaffold.models import User
    from tests.conftest import user_key
    user = db_session.query(User).one()

    def shrink():  # as if sized before projections existed
        with user_key(user):
            db_session.get(Sale, sale["id"]).shares = 10
            db_session.commit()
    shrink()
    assert resize_generated_payoff_sales(db_session) == 1
    assert next(s for s in client.get("/api/sales").json() if s["id"] == sale["id"])["shares"] == right
    assert next(s for s in client.get("/api/sales").json() if s["id"] == mine["id"])["shares"] == 7
    shrink()
    assert resize_generated_payoff_sales(db_session) == 0  # once


def test_a_payoff_sale_on_its_due_date_still_carries_a_projected_tax_loan(client):
    """Sizing a sale for its own due date must not move "today" to that date,
    or every vest before it stops counting as future and its Tax loan drops."""
    loan = _api_account(client)
    client.post("/api/grants", json={"year": 2030, "type": "Free", "shares": 1_000, "price": 0.0,
                                     "vest_start": "2036-09-30", "periods": 1,
                                     "exercise_date": "2030-12-31", "dp_shares": 0})
    s = client.get(f"/api/loans/{loan['id']}/payoff-sale-suggestion").json()
    event = next(e for e in client.get("/api/events").json()
                 if e["event_type"] == "Loan Payoff" and e.get("loan_db_id") == loan["id"])
    assert event["projected_tax_loans"] == pytest.approx(1_000 * 4.0 * 0.52)
    assert s["cash_due"] == pytest.approx(event["cash_due"], abs=0.01)


def test_a_late_payoff_once_recorded_settles_on_its_own_date():
    """Confirmed (and sold) on 2026-11-15, a loan due 2026-01-01 is settled
    then — not snapped back to the old due date with an orphan beside it."""
    loan = _loan(1, 2020, "Purchase", "Purchase", 2025, 100_000.0, 0.05, date(2026, 1, 1), date(2025, 1, 1))
    confirm = date(2026, 11, 15)
    before = project([loan], [], [], today=confirm, assumed_rate=0.05, settle_on=confirm)
    sale = {"loan_id": 1, "date": confirm}
    after = project([loan], [], [], today=confirm, assumed_rate=0.05, sales=[sale])
    assert after.payoff_for(1).date == confirm
    assert before.extra_for(1) > 0
    assert after.extra_for(1) == pytest.approx(before.extra_for(1), abs=0.01)
    assert after.orphan_payoffs() == []
    later = project([loan], [], [], today=date(2027, 6, 1), assumed_rate=0.05, sales=[sale])
    assert later.extra_for(1) == pytest.approx(before.extra_for(1), abs=0.01)


def test_a_later_loan_rate_does_not_rewrite_a_snapshot():
    stop = date(2024, 6, 1)
    later = _loan(2, 2020, "Purchase", "Interest", 2025, 1_000.0, 0.20, date(2032, 12, 31))
    a = outstanding_at_stop(project([_purchase_2020()], [], [], today=date(2026, 1, 1), stop=stop))
    b = outstanding_at_stop(project([_purchase_2020(), later], [], [], today=date(2026, 1, 1), stop=stop))
    assert a == b


def test_a_failed_resize_is_retried_and_finished_ones_are_not(client, db_session, monkeypatch):
    import app.routers.loans as loans_router
    from scaffold.models import Sale, User
    from tests.conftest import user_key
    loan = _api_account(client)
    sale_id = next(s["id"] for s in client.get("/api/sales").json() if s["loan_id"] == loan["id"])
    right = next(s["shares"] for s in client.get("/api/sales").json() if s["id"] == sale_id)
    user = db_session.query(User).one()
    with user_key(user):
        db_session.get(Sale, sale_id).shares = 10
        db_session.commit()

    real = loans_router._regenerate_future_payoff_sales
    def boom(*a, **k):
        raise RuntimeError("transient")
    monkeypatch.setattr(loans_router, "_regenerate_future_payoff_sales", boom)
    assert loans_router.resize_generated_payoff_sales(db_session) == 0
    monkeypatch.setattr(loans_router, "_regenerate_future_payoff_sales", real)
    assert loans_router.resize_generated_payoff_sales(db_session) == 1
    assert next(s for s in client.get("/api/sales").json() if s["id"] == sale_id)["shares"] == right
    assert loans_router.resize_generated_payoff_sales(db_session) == 0
