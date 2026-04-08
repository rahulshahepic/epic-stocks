"""Tests for wizard endpoints: parse-file and submit."""
import sys
import os
import io
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import openpyxl
from tests.conftest import register_user

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "test_data", "fixture.xlsx")


# ── parse-file ────────────────────────────────────────────────────────────────

def test_parse_file_fixture(client):
    """Parsing the fixture file returns grants and prices without errors."""
    register_user(client)
    with open(FIXTURE, "rb") as f:
        resp = client.post(
            "/api/wizard/parse-file",
            files={"file": ("fixture.xlsx", f, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["grants"]) == 12
    assert len(data["prices"]) == 8
    # Structural fields present
    assert data["grants"][0]["year"] is not None
    assert data["grants"][0]["type"] is not None
    assert data["grants"][0]["periods"] is not None


def test_parse_file_template_no_numbers(client):
    """Parsing an xlsx with rows but missing share counts returns nulls, not errors."""
    register_user(client)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Schedule"
    # Header row
    ws.append(["year", "type", "shares", "price", "vest_start", "periods", "exercise_date", "dp_shares"])
    # Data row with structural info but no shares
    ws.append([2021, "Purchase", None, None, "2022-03-01", 4, "2021-12-31", None])

    ws2 = wb.create_sheet("Prices")
    ws2.append(["effective_date", "price"])
    ws2.append(["2021-12-31", None])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    resp = client.post(
        "/api/wizard/parse-file",
        files={"file": ("template.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["grants"]) == 1
    assert data["grants"][0]["year"] == 2021
    assert data["grants"][0]["periods"] == 4
    assert "shares" not in data["grants"][0]  # shares is personal data, not in template
    assert len(data["prices"]) == 1
    assert data["prices"][0]["price"] is None  # tolerant


def test_parse_file_empty_returns_empty(client):
    """An xlsx with no data rows returns empty lists."""
    register_user(client)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Schedule"
    ws.append(["year", "type", "shares"])  # header only

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    resp = client.post(
        "/api/wizard/parse-file",
        files={"file": ("empty.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert resp.status_code == 200
    assert resp.json()["grants"] == []


def test_parse_file_invalid_returns_422(client):
    """A non-Excel file returns 422."""
    register_user(client)
    resp = client.post(
        "/api/wizard/parse-file",
        files={"file": ("bad.xlsx", b"not an excel file", "application/octet-stream")},
    )
    assert resp.status_code == 422


def test_parse_file_requires_auth(client):
    """Unauthenticated parse-file request is rejected."""
    resp = client.post(
        "/api/wizard/parse-file",
        files={"file": ("x.xlsx", b"", "application/octet-stream")},
    )
    assert resp.status_code in (401, 403)


# ── submit ────────────────────────────────────────────────────────────────────

MINIMAL_PAYLOAD = {
    "prices": [{"effective_date": "2021-12-31", "price": 2.50}],
    "grants": [
        {
            "year": 2021,
            "type": "Purchase",
            "shares": 1000,
            "price": 2.50,
            "vest_start": "2022-03-01",
            "periods": 4,
            "exercise_date": "2021-12-31",
            "dp_shares": 0,
            "loans": [],
        }
    ],
}


def test_submit_creates_grant_and_price(client):
    """Wizard submit creates grants and prices."""
    register_user(client)
    resp = client.post("/api/wizard/submit", json=MINIMAL_PAYLOAD)
    assert resp.status_code == 201
    data = resp.json()
    assert data["grants"] == 1
    assert data["prices"] == 1
    assert data["loans"] == 0

    grants = client.get("/api/grants").json()
    assert len(grants) == 1
    assert grants[0]["year"] == 2021

    prices = client.get("/api/prices").json()
    assert len(prices) == 1


def test_submit_with_purchase_loan(client):
    """Wizard submit creates grant + Purchase loan."""
    register_user(client)
    payload = {
        "prices": [{"effective_date": "2021-12-31", "price": 2.50}],
        "grants": [
            {
                "year": 2021,
                "type": "Purchase",
                "shares": 1000,
                "price": 2.50,
                "vest_start": "2022-03-01",
                "periods": 4,
                "exercise_date": "2021-12-31",
                "dp_shares": 0,
                "loans": [
                    {
                        "loan_number": "111111",
                        "loan_type": "Purchase",
                        "loan_year": 2021,
                        "amount": 2000.00,
                        "interest_rate": 0.045,
                        "due_date": "2025-12-31",
                        "refinances_loan_number": "",
                    }
                ],
            }
        ],
    }
    resp = client.post("/api/wizard/submit", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["loans"] == 1

    loans = client.get("/api/loans").json()
    assert len(loans) == 1
    assert loans[0]["loan_type"] == "Purchase"
    assert loans[0]["loan_number"] == "111111"


def test_submit_resolves_refinance_chain(client):
    """Loans referencing another by loan_number get refinances_loan_id resolved."""
    register_user(client)
    payload = {
        "prices": [{"effective_date": "2021-12-31", "price": 2.50}],
        "grants": [
            {
                "year": 2021,
                "type": "Purchase",
                "shares": 1000,
                "price": 2.50,
                "vest_start": "2022-03-01",
                "periods": 4,
                "exercise_date": "2021-12-31",
                "dp_shares": 0,
                "loans": [
                    {
                        "loan_number": "111111",
                        "loan_type": "Purchase",
                        "loan_year": 2021,
                        "amount": 2000.00,
                        "interest_rate": 0.045,
                        "due_date": "2025-12-31",
                        "refinances_loan_number": "",
                    },
                    {
                        "loan_number": "222222",
                        "loan_type": "Purchase",
                        "loan_year": 2023,
                        "amount": 2100.00,
                        "interest_rate": 0.05,
                        "due_date": "2028-12-31",
                        "refinances_loan_number": "111111",
                    },
                ],
            }
        ],
    }
    resp = client.post("/api/wizard/submit", json=payload)
    assert resp.status_code == 201
    assert resp.json()["loans"] == 2

    loans = client.get("/api/loans").json()
    original = next(l for l in loans if l["loan_number"] == "111111")
    refinance = next(l for l in loans if l["loan_number"] == "222222")
    assert refinance["refinances_loan_id"] == original["id"]


def test_submit_with_tax_loan(client):
    """Wizard submit creates a Catch-Up grant with a Tax loan."""
    register_user(client)
    payload = {
        "prices": [{"effective_date": "2021-12-31", "price": 2.50}],
        "grants": [
            {
                "year": 2021,
                "type": "Catch-Up",
                "shares": 500,
                "price": 0.0,
                "vest_start": "2022-03-01",
                "periods": 4,
                "exercise_date": "2021-12-31",
                "dp_shares": 0,
                "loans": [
                    {
                        "loan_number": "333333",
                        "loan_type": "Tax",
                        "loan_year": 2022,
                        "amount": 800.00,
                        "interest_rate": 0.05,
                        "due_date": "2026-12-31",
                        "refinances_loan_number": "",
                    }
                ],
            }
        ],
    }
    resp = client.post("/api/wizard/submit", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["grants"] == 1
    assert data["loans"] == 1

    loans = client.get("/api/loans").json()
    assert loans[0]["loan_type"] == "Tax"
    assert loans[0]["grant_type"] == "Catch-Up"


def test_submit_clears_existing_data(client):
    """Submit with clear_existing=True replaces all prior data."""
    register_user(client)
    # Pre-populate
    client.post("/api/prices", json={"effective_date": "2020-01-01", "price": 1.50})
    assert len(client.get("/api/prices").json()) == 1

    resp = client.post("/api/wizard/submit", json=MINIMAL_PAYLOAD)
    assert resp.status_code == 201

    prices = client.get("/api/prices").json()
    assert len(prices) == 1
    assert prices[0]["price"] == 2.50  # replaced, not appended


def test_submit_multiple_grants(client):
    """Multiple grants across different years and types are all created."""
    register_user(client)
    payload = {
        "prices": [
            {"effective_date": "2020-12-31", "price": 2.00},
            {"effective_date": "2021-03-01", "price": 2.50},
        ],
        "grants": [
            {
                "year": 2020,
                "type": "Purchase",
                "shares": 800,
                "price": 2.00,
                "vest_start": "2021-03-01",
                "periods": 4,
                "exercise_date": "2020-12-31",
                "dp_shares": 0,
                "loans": [],
            },
            {
                "year": 2020,
                "type": "Catch-Up",
                "shares": 200,
                "price": 0.0,
                "vest_start": "2021-03-01",
                "periods": 4,
                "exercise_date": "2020-12-31",
                "dp_shares": 0,
                "loans": [],
            },
        ],
    }
    resp = client.post("/api/wizard/submit", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["grants"] == 2
    assert data["prices"] == 2


def test_submit_requires_auth(client):
    """Unauthenticated submit is rejected."""
    resp = client.post("/api/wizard/submit", json=MINIMAL_PAYLOAD)
    assert resp.status_code in (401, 403)
