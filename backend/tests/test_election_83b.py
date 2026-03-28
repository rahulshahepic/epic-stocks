"""Tests for 83(b) election feature on bonus grants."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tests.conftest import register_user

PRICE_DATA = {"effective_date": "2020-01-01", "price": 10.0}

BONUS_BASE = {
    "year": 2020,
    "shares": 1000,
    "vest_start": "2021-01-01",
    "periods": 4,
    "exercise_date": "2025-12-31",
}


def test_add_bonus_without_83b(client):
    register_user(client)
    resp = client.post("/api/flows/add-bonus", json={**BONUS_BASE})
    assert resp.status_code == 201
    data = resp.json()
    assert data["election_83b"] is False


def test_add_bonus_with_83b(client):
    register_user(client)
    resp = client.post("/api/flows/add-bonus", json={**BONUS_BASE, "election_83b": True})
    assert resp.status_code == 201
    data = resp.json()
    assert data["election_83b"] is True


def test_update_grant_sets_83b(client):
    register_user(client)
    # Create without 83b
    resp = client.post("/api/flows/add-bonus", json=BONUS_BASE)
    grant_id = resp.json()["id"]
    version = resp.json()["version"]

    # Update to enable 83b
    resp = client.put(f"/api/grants/{grant_id}", json={"election_83b": True, "version": version})
    assert resp.status_code == 200
    assert resp.json()["election_83b"] is True


def test_events_vesting_annotated_with_83b(client):
    register_user(client)

    client.post("/api/prices", json=PRICE_DATA)
    client.post("/api/flows/add-bonus", json={**BONUS_BASE, "election_83b": True})

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    vesting_events = [e for e in events if e["event_type"] == "Vesting"]
    assert len(vesting_events) > 0
    for e in vesting_events:
        assert e["election_83b"] is True, f"Expected election_83b=True on vesting event: {e}"


def test_events_vesting_no_83b_flag_when_not_set(client):
    register_user(client)

    client.post("/api/prices", json=PRICE_DATA)
    client.post("/api/flows/add-bonus", json=BONUS_BASE)

    resp = client.get("/api/events")
    assert resp.status_code == 200
    events = resp.json()

    vesting_events = [e for e in events if e["event_type"] == "Vesting"]
    assert len(vesting_events) > 0
    for e in vesting_events:
        assert e.get("election_83b") is False, f"Expected election_83b=False: {e}"


def test_83b_grant_still_has_income_in_core(client):
    """Core.py still computes income for price=0 grants; the 83b flag is display-only."""
    register_user(client)

    client.post("/api/prices", json=PRICE_DATA)
    client.post("/api/flows/add-bonus", json={**BONUS_BASE, "election_83b": True})

    resp = client.get("/api/events")
    events = resp.json()
    vesting_events = [e for e in events if e["event_type"] == "Vesting"]
    # income is still populated (used as unrealized gain on frontend)
    assert any(e["income"] > 0 for e in vesting_events)


def test_grant_list_returns_83b_field(client):
    register_user(client)

    client.post("/api/flows/add-bonus", json={**BONUS_BASE, "election_83b": True})
    resp = client.get("/api/grants")
    assert resp.status_code == 200
    grants = resp.json()
    assert len(grants) == 1
    assert grants[0]["election_83b"] is True
