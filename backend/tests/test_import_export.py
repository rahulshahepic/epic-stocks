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
    assert last["cum_shares"] == 558500


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


def test_import_rejects_duplicate_grants_in_sheet(client):
    """Import with two rows having the same year+type in Schedule sheet returns 400."""
    token = register_user(client)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Schedule"
    headers = ["Year", "Type", "Shares", "Price", "Vest Start", "Periods", "Exercise Date", "DP Shares"]
    ws.append(headers)
    row = [2020, "Purchase", 10000, 1.99, "2021-03-01", 5, "2020-12-31", 0]
    ws.append(row)
    ws.append(row)  # duplicate

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    resp = client.post(
        "/api/import/excel",
        files={"file": ("dup.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "Duplicate" in resp.json()["detail"]


# ============================================================
# IMPORT BACKUPS
# ============================================================

def test_import_creates_backup(client):
    """After import, a backup of the replaced data is created."""
    token = register_user(client)
    # First import to populate data
    with open(FIXTURE, "rb") as f:
        client.post("/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token))
    # Second import should create a backup of the first import's data
    with open(FIXTURE, "rb") as f:
        client.post("/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token))
    backups = client.get("/api/import/backups", headers=auth_header(token)).json()
    assert len(backups) >= 1
    assert backups[0]["grant_count"] == 12
    assert backups[0]["price_count"] == 8
    assert backups[0]["loan_count"] == 21


def test_import_backup_trimmed_to_three(client):
    """Backups are capped at 3 per user."""
    token = register_user(client)
    with open(FIXTURE, "rb") as f:
        data = f.read()
    for _ in range(5):
        client.post("/api/import/excel",
            files={"file": ("fixture.xlsx", io.BytesIO(data), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token))
    backups = client.get("/api/import/backups", headers=auth_header(token)).json()
    assert len(backups) <= 3


def test_import_no_backup_when_empty(client):
    """No backup is created when there's nothing to back up."""
    token = register_user(client)
    with open(FIXTURE, "rb") as f:
        client.post("/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token))
    backups = client.get("/api/import/backups", headers=auth_header(token)).json()
    # First import has no previous data so no backup
    assert len(backups) == 0


def test_restore_backup(client):
    """Restoring a backup brings back the pre-import data."""
    token = register_user(client)
    # Import fixture (12 grants)
    with open(FIXTURE, "rb") as f:
        client.post("/api/import/excel",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token))
    grants_after_first = client.get("/api/grants", headers=auth_header(token)).json()
    assert len(grants_after_first) == 12

    # Build a minimal xlsx with 1 grant
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Schedule"
    ws.append(["Year", "Type", "Shares", "Price", "Vest Start", "Periods", "Exercise Date", "DP Shares"])
    ws.append([2024, "Bonus", 5000, 0.00, "2024-01-01", 4, "2024-12-31", 0])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    client.post("/api/import/excel",
        files={"file": ("one.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token))
    # Now only 1 grant
    assert len(client.get("/api/grants", headers=auth_header(token)).json()) == 1

    # Restore the backup
    backups = client.get("/api/import/backups", headers=auth_header(token)).json()
    assert len(backups) >= 1
    resp = client.post(f"/api/import/backups/{backups[0]['id']}/restore", headers=auth_header(token))
    assert resp.status_code == 200
    assert resp.json()["restored_grants"] == 12
    # Should be back to 12 grants
    assert len(client.get("/api/grants", headers=auth_header(token)).json()) == 12


def test_restore_backup_wrong_user(client):
    """Cannot restore another user's backup."""
    token1 = register_user(client, "user1@example.com")
    token2 = register_user(client, "user2@example.com")
    with open(FIXTURE, "rb") as f:
        data = f.read()
    # User1 imports twice to create a backup
    for _ in range(2):
        client.post("/api/import/excel",
            files={"file": ("fixture.xlsx", io.BytesIO(data), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            headers=auth_header(token1))
    backups = client.get("/api/import/backups", headers=auth_header(token1)).json()
    assert len(backups) >= 1
    # User2 tries to restore user1's backup
    resp = client.post(f"/api/import/backups/{backups[0]['id']}/restore", headers=auth_header(token2))
    assert resp.status_code == 404
