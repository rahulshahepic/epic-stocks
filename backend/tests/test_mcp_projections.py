"""Projections belong to the user, not to the connector.

People enter assumed future share prices so the app's planner has something to
work with. The connector used to hand those over indistinguishably from real
valuations: `list_prices` returned one ascending list ending in a 2034
assumption, and `get_dashboard` reported the *end* of the timeline as
`current_price`. An assistant read that as today's price and reasoned from a
decade of invented growth.

The dates on the timeline are facts — the vesting schedule is company-wide. The
money attached to future dates is an assumption. These tests hold that line.
"""
import os
import sys
from datetime import date, timedelta

import pytest
from sqlalchemy import text

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user
from tests.test_mcp_tools import GRANT, Mcp

REAL_PRICE = 4.0
PROJECTED_PRICE = 40.0

# GRANT finished vesting years ago. A real account almost always has something
# still to come, and "what vests next?" is the question people ask an assistant.
ONGOING_GRANT = {
    "year": date.today().year - 1, "type": "Bonus", "shares": 4000, "price": 0,
    "vest_start": f"{date.today().year}-03-01", "periods": 5,
    "exercise_date": f"{date.today().year - 1}-12-31",
}


@pytest.fixture()
def mcp(client):
    """An account priced for real up to this year and projected far past it."""
    register_user(client)
    client.post("/api/grants", json=GRANT)
    client.post("/api/grants", json=ONGOING_GRANT)
    client.post("/api/prices", json={"effective_date": "2021-06-01", "price": 1.5})
    client.post("/api/prices", json={
        "effective_date": date.today().replace(month=1, day=1).isoformat(),
        "price": REAL_PRICE,
    })
    # The user's own planning assumption, a decade out.
    far = date.today().replace(year=date.today().year + 8, month=1, day=1)
    # is_estimate is derived from the date, never sent: see prices.create_price.
    client.post("/api/prices", json={"effective_date": far.isoformat(),
                                     "price": PROJECTED_PRICE})
    return Mcp(client)


# ── the price ───────────────────────────────────────────────────────────────

def test_the_current_price_is_the_real_one_not_the_projection(mcp):
    prices = mcp.call("list_prices")
    assert prices["current_price"] == REAL_PRICE
    assert prices["current_price_date"].startswith(str(date.today().year))


def test_projections_are_left_out_unless_asked_for(mcp):
    """The failure was reading the newest row as the current price. There is no
    newest row to misread any more."""
    prices = mcp.call("list_prices")
    listed = [p["price"] for p in prices["prices"]]
    assert PROJECTED_PRICE not in listed
    assert listed[-1] == REAL_PRICE
    assert "projected" in prices["note"]


def test_projections_come_back_labelled_when_asked_for(mcp):
    prices = mcp.call("list_prices", include_projections=True)
    assert [p["price"] for p in prices["projected_prices"]] == [PROJECTED_PRICE]
    warning = prices["projection_warning"]
    assert "assumptions" in warning
    assert "never present a projected price" in warning.lower()
    # Still kept out of the real list.
    assert PROJECTED_PRICE not in [p["price"] for p in prices["prices"]]


def test_an_account_with_no_real_price_says_so_rather_than_guessing(client):
    register_user(client)
    client.post("/api/grants", json=GRANT)
    future = (date.today() + timedelta(days=400)).isoformat()
    client.post("/api/prices", json={"effective_date": future, "price": 12.0})

    prices = Mcp(client).call("list_prices")
    assert prices["current_price"] is None
    assert "no current price" in prices["note"]


# ── the dashboard ───────────────────────────────────────────────────────────

def test_the_dashboard_reports_today_not_the_end_of_the_projection(mcp):
    """This is the bug verbatim: current_price held the projected 2034 price."""
    dash = mcp.call("get_dashboard")
    assert dash["current_price"] == REAL_PRICE
    assert dash["current_price"] != PROJECTED_PRICE
    assert dash["as_of"] == date.today().isoformat()


def test_the_unbounded_endpoint_is_the_one_that_runs_to_the_projection(mcp, client):
    """Why the tool passes as_of at all. The app never shows this either — it
    computes its own card values for the date in its picker."""
    unbounded = client.get("/api/dashboard").json()
    assert unbounded["current_price"] == PROJECTED_PRICE
    assert mcp.call("get_dashboard")["current_price"] == REAL_PRICE


def test_the_dashboard_says_when_its_figures_rest_on_an_assumption(client, db_session):
    """A price is an estimate because its date was in the future when it was
    entered (`prices.create_price`). Time then passes: the date falls behind us,
    nobody enters a real valuation, and the assumption is now the price in
    effect. The figures are still the app's to compute — but the connector has
    to say what they rest on.
    """
    register_user(client)
    client.post("/api/grants", json=GRANT)
    client.post("/api/prices", json={"effective_date": "2021-06-01", "price": 1.5})
    ahead = (date.today() + timedelta(days=200)).isoformat()
    price_id = client.post("/api/prices",
                           json={"effective_date": ahead, "price": 9.0}).json()["id"]
    # Move the calendar past it. Straight SQL: the API recomputes is_estimate
    # from the date on every write, so there is no other way to reach this state.
    db_session.execute(text("UPDATE prices SET effective_date = :d WHERE id = :i"),
                       {"d": date.today().replace(month=1, day=1), "i": price_id})
    db_session.commit()

    dash = Mcp(client).call("get_dashboard")
    assert dash["price_is_estimate"] is True
    assert "not a real valuation" in dash["projection_warning"]


def test_a_real_price_covering_today_is_not_flagged(mcp):
    dash = mcp.call("get_dashboard")
    assert dash["price_is_estimate"] is False
    assert "projection_warning" not in dash


# ── the timeline ────────────────────────────────────────────────────────────

def test_future_events_are_marked_as_projected_valuations(mcp):
    events = mcp.call("list_events")
    assert events["priced_to"], "the newest real valuation should be reported"

    future = [e for e in events["events"] if e["date"] > events["priced_to"]]
    assert future, "the seeded account vests past the newest real price"
    assert all(e["valuation_is_projected"] for e in future)
    assert "the money is not" in events["projection_warning"]


def test_events_up_to_the_newest_real_price_are_not_marked(mcp):
    events = mcp.call("list_events")
    settled = [e for e in events["events"] if e["date"] <= events["priced_to"]]
    assert settled, "the account has history before the newest real price"
    assert not any(e["valuation_is_projected"] for e in settled)


def test_no_warning_when_nothing_is_projected(mcp):
    """A model should not be told to hedge figures that are real."""
    events = mcp.call("list_events", to_date=mcp.call("list_events")["priced_to"])
    assert "projection_warning" not in events


def test_future_vesting_dates_are_still_reported(mcp):
    """The schedule is a company-wide fact. Refusing to answer "what vests
    next?" would be the wrong correction."""
    events = mcp.call("list_events", event_types=["Vesting"])
    future = [e for e in events["events"] if e["date"] > date.today().isoformat()]
    assert future, "future vesting must still be visible"
    assert all(e["vested_shares"] for e in future)
    # Flagged, not withheld: the date and the share count are facts, the
    # valuation attached to them is not.
    assert all(e["valuation_is_projected"] for e in future)
