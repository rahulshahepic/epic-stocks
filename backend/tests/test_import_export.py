"""Tests for Excel import/export API endpoints."""
import sys
import os
import io
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import openpyxl
from tests.conftest import register_user, auth_header

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "test_data", "fixture.xlsx")


# ============================================================
# IMPORT
# ============================================================

def test_import_fixture(client):
    """Import test fixture → correct row counts (12 grants, 8 prices, 21 loans)."""
    token = register_user(client)
    with open(FIXTURE, "rb") as f:
        resp = client.post(
            "/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token),
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["grants"] == 12
    assert data["prices"] == 8
    assert data["loans"] == 21


def test_import_populates_tables(client):
    """After import, CRUD endpoints return the imported data."""
    token = register_user(client)
    with open(FIXTURE, "rb") as f:
        client.post(
            "/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token),
        )
    grants = client.get("/api/grants", headers=auth_header(token)).json()
    loans = client.get("/api/loans", headers=auth_header(token)).json()
    prices = client.get("/api/prices", headers=auth_header(token)).json()
    assert len(grants) == 12
    assert len(loans) == 21
    assert len(prices) == 8


def test_import_wipes_existing_data(client):
    """Import replaces existing data — doesn't append."""
    token = register_user(client)
    # Create some existing data
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 99.99}, headers=auth_header(token))
    prices_before = client.get("/api/prices", headers=auth_header(token)).json()
    assert len(prices_before) == 1

    # Import overwrites
    with open(FIXTURE, "rb") as f:
        client.post(
            "/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token),
        )
    prices_after = client.get("/api/prices", headers=auth_header(token)).json()
    assert len(prices_after) == 8  # Not 9


def test_import_preserves_other_users(client):
    """Import wipes only the importing user's data, not other users'."""
    token_a = register_user(client, "a@test.com")
    token_b = register_user(client, "b@test.com")

    # User A creates a price
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 99.99}, headers=auth_header(token_a))

    # User B imports
    with open(FIXTURE, "rb") as f:
        client.post(
            "/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token_b),
        )

    # User A's data is untouched
    prices_a = client.get("/api/prices", headers=auth_header(token_a)).json()
    assert len(prices_a) == 1


def test_import_events_match_known_values(client):
    """After importing fixture, /api/events produces the known-good totals."""
    token = register_user(client)
    with open(FIXTURE, "rb") as f:
        client.post(
            "/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token),
        )
    events = client.get("/api/events", headers=auth_header(token)).json()
    assert len(events) == 89
    last = events[-1]
    assert last["cum_shares"] == 571500


def test_import_rejects_non_excel(client):
    token = register_user(client)
    resp = client.post(
        "/api/import/excel",
        files={"file": ("data.csv", b"a,b,c\n1,2,3", "text/csv")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400


# ============================================================
# EXPORT
# ============================================================

def test_export_empty(client):
    """Export with no data returns a valid xlsx with 4 sheets."""
    token = register_user(client)
    resp = client.get("/api/export/excel", headers=auth_header(token))
    assert resp.status_code == 200
    assert "spreadsheetml" in resp.headers["content-type"]

    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    assert "Schedule" in wb.sheetnames
    assert "Loans" in wb.sheetnames
    assert "Prices" in wb.sheetnames
    assert "Events" in wb.sheetnames
    wb.close()


def test_export_has_data(client):
    """Export after import contains the imported data."""
    token = register_user(client)
    with open(FIXTURE, "rb") as f:
        client.post(
            "/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token),
        )
    resp = client.get("/api/export/excel", headers=auth_header(token))
    assert resp.status_code == 200

    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    # Count data rows (skip header)
    sched_rows = sum(1 for r in range(2, 100) if wb["Schedule"].cell(r, 1).value is not None)
    loan_rows = sum(1 for r in range(2, 100) if wb["Loans"].cell(r, 6).value is not None)
    price_rows = sum(1 for r in range(2, 30) if wb["Prices"].cell(r, 1).value is not None)
    assert sched_rows == 12
    assert loan_rows == 21
    assert price_rows == 8
    wb.close()


def test_export_roundtrip(client):
    """Import fixture → export → re-import exported file → same event count."""
    token = register_user(client)

    # Import fixture
    with open(FIXTURE, "rb") as f:
        client.post(
            "/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token),
        )
    events_before = client.get("/api/events", headers=auth_header(token)).json()

    # Export
    resp = client.get("/api/export/excel", headers=auth_header(token))
    exported = resp.content

    # Re-import the exported file
    resp2 = client.post(
        "/api/import/excel",
        files={"file": ("exported.xlsx", io.BytesIO(exported), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp2.status_code == 201

    events_after = client.get("/api/events", headers=auth_header(token)).json()
    assert len(events_after) == len(events_before)
    assert events_after[-1]["cum_shares"] == events_before[-1]["cum_shares"]
