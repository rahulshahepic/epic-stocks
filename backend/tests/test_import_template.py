"""Tests for template download, partial import, and import validation."""
import sys, os, io
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import openpyxl
from datetime import date
from tests.conftest import register_user, auth_header


def _make_xlsx(sheets: dict[str, list[list]]) -> bytes:
    """Build a minimal xlsx with given sheets. Each sheet is {name: [[row1], [row2], ...]}."""
    wb = openpyxl.Workbook()
    first = True
    for name, rows in sheets.items():
        ws = wb.active if first else wb.create_sheet(name)
        if first:
            ws.title = name
            first = False
        for r, row in enumerate(rows, 1):
            for c, val in enumerate(row, 1):
                ws.cell(row=r, column=c, value=val)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ============================================================
# TEMPLATE DOWNLOAD
# ============================================================

def test_template_download(client):
    token = register_user(client)
    resp = client.get("/api/import/template", headers=auth_header(token))
    assert resp.status_code == 200
    assert "Vesting_Template" in resp.headers["content-disposition"]
    # Verify it's a valid xlsx with expected sheets
    wb = openpyxl.load_workbook(io.BytesIO(resp.content))
    assert "Schedule" in wb.sheetnames
    assert "Loans" in wb.sheetnames
    assert "Prices" in wb.sheetnames
    # Headers should be present
    assert wb["Schedule"].cell(1, 1).value == "Year"
    assert wb["Loans"].cell(1, 1).value == "Loan #"
    assert wb["Prices"].cell(1, 1).value == "Date"
    # Example data in row 2
    assert wb["Schedule"].cell(2, 2).value == "Purchase"
    wb.close()


# ============================================================
# PARTIAL IMPORT
# ============================================================

def test_import_prices_only(client):
    """Upload with only Prices sheet — should import prices without touching grants/loans."""
    token = register_user(client)

    # First add a grant via API
    client.post("/api/grants", json={
        "year": 2020, "type": "Purchase", "shares": 100, "price": 5.0,
        "vest_start": "2020-01-01", "periods": 5, "exercise_date": "2025-01-01",
    }, headers=auth_header(token))

    # Now import prices-only xlsx
    xlsx = _make_xlsx({"Prices": [
        ["Date", "Price"],
        [date(2020, 1, 1), 5.0],
        [date(2021, 1, 1), 8.0],
    ]})
    resp = client.post("/api/import/excel",
        files={"file": ("prices.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["prices"] == 2
    assert data["grants"] == 0
    assert data["loans"] == 0
    assert "Prices" in data["sheets_imported"]
    assert "Schedule" not in data["sheets_imported"]

    # Grant should still exist
    grants = client.get("/api/grants", headers=auth_header(token)).json()
    assert len(grants) == 1


def test_import_schedule_only(client):
    """Upload with only Schedule sheet."""
    token = register_user(client)

    # Add a price first
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 5.0},
                headers=auth_header(token))

    xlsx = _make_xlsx({"Schedule": [
        ["Year", "Type", "Shares", "Price", "Vest Start", "Periods", "", "", "", "", "", "", "", "Exercise Date", "DP Shares"],
        [2020, "Purchase", 100, 5.0, date(2020, 1, 1), 5, None, None, None, None, None, None, None, date(2025, 1, 1), 0],
    ]})
    resp = client.post("/api/import/excel",
        files={"file": ("grants.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 201
    assert resp.json()["grants"] == 1
    assert resp.json()["prices"] == 0

    # Price should still exist
    prices = client.get("/api/prices", headers=auth_header(token)).json()
    assert len(prices) == 1


def test_import_no_recognized_sheets(client):
    """File with no recognized sheets returns 400."""
    token = register_user(client)
    xlsx = _make_xlsx({"RandomSheet": [["foo", "bar"]]})
    resp = client.post("/api/import/excel",
        files={"file": ("bad.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "No recognized sheets" in resp.json()["detail"]


# ============================================================
# IMPORT VALIDATION
# ============================================================

def test_import_rejects_empty_grant_type(client):
    token = register_user(client)
    xlsx = _make_xlsx({"Schedule": [
        ["Year", "Type", "Shares", "Price", "Vest Start", "Periods", "", "", "", "", "", "", "", "Exercise Date", "DP Shares"],
        [2020, "", 100, 5.0, date(2020, 1, 1), 5, None, None, None, None, None, None, None, date(2025, 1, 1), 0],
    ]})
    resp = client.post("/api/import/excel",
        files={"file": ("bad.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "type cannot be empty" in resp.json()["detail"]

def test_import_rejects_negative_shares(client):
    token = register_user(client)
    xlsx = _make_xlsx({"Schedule": [
        ["Year", "Type", "Shares", "Price", "Vest Start", "Periods", "", "", "", "", "", "", "", "Exercise Date", "DP Shares"],
        [2020, "Purchase", -10, 5.0, date(2020, 1, 1), 5, None, None, None, None, None, None, None, date(2025, 1, 1), 0],
    ]})
    resp = client.post("/api/import/excel",
        files={"file": ("bad.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "shares must be positive" in resp.json()["detail"]

def test_import_rejects_negative_loan_rate(client):
    token = register_user(client)
    xlsx = _make_xlsx({"Loans": [
        ["Loan #", "Grant Year", "Grant Type", "Loan Type", "Loan Year", "Amount", "Rate", "Due Date"],
        ["L1", 2020, "Purchase", "Interest", 2020, 5000, -0.05, date(2025, 1, 1)],
    ]})
    resp = client.post("/api/import/excel",
        files={"file": ("bad.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "interest_rate" in resp.json()["detail"]

def test_import_rejects_negative_price(client):
    token = register_user(client)
    xlsx = _make_xlsx({"Prices": [
        ["Date", "Price"],
        [date(2020, 1, 1), -5.0],
    ]})
    resp = client.post("/api/import/excel",
        files={"file": ("bad.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        headers=auth_header(token),
    )
    assert resp.status_code == 400
    assert "price must be positive" in resp.json()["detail"]
