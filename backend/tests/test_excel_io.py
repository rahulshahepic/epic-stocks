import sys
import os
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from excel_io import read_all_from_excel, read_grants_from_excel, read_prices_from_excel, read_loans_from_excel
from core import generate_all_events, compute_timeline

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "test_data", "fixture.xlsx")


def test_read_grants_count():
    import openpyxl
    wb = openpyxl.load_workbook(FIXTURE)
    grants = read_grants_from_excel(wb["Schedule"])
    wb.close()
    assert len(grants) == 12


def test_read_prices_count():
    import openpyxl
    wb = openpyxl.load_workbook(FIXTURE)
    prices = read_prices_from_excel(wb["Prices"])
    wb.close()
    assert len(prices) == 8


def test_read_loans_count():
    import openpyxl
    wb = openpyxl.load_workbook(FIXTURE)
    loans = read_loans_from_excel(wb["Loans"])
    wb.close()
    assert len(loans) == 21


def test_read_all_initial_price():
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    assert initial_price == prices[0]["price"]
    assert initial_price > 0


def test_grant_fields():
    import openpyxl
    wb = openpyxl.load_workbook(FIXTURE)
    grants = read_grants_from_excel(wb["Schedule"])
    wb.close()
    g = grants[0]
    assert isinstance(g["year"], int)
    assert isinstance(g["type"], str)
    assert isinstance(g["shares"], int)
    assert isinstance(g["price"], float)
    assert isinstance(g["periods"], int)
    assert g["vest_start"] is not None
    assert g["exercise_date"] is not None


def test_loan_fields():
    import openpyxl
    wb = openpyxl.load_workbook(FIXTURE)
    loans = read_loans_from_excel(wb["Loans"])
    wb.close()
    loan = loans[0]
    assert isinstance(loan["amount"], float)
    assert isinstance(loan["interest_rate"], float)
    assert loan["loan_type"] in ("Purchase", "Interest", "Tax")
    assert loan["due"] is not None


def test_price_fields():
    import openpyxl
    wb = openpyxl.load_workbook(FIXTURE)
    prices = read_prices_from_excel(wb["Prices"])
    wb.close()
    p = prices[0]
    assert isinstance(p["price"], float)
    assert p["date"] is not None


def test_roundtrip_generates_correct_events():
    """Read fixture, generate events, verify known-good totals."""
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)
    assert len(events) == 89
    assert timeline[-1]["cum_shares"] == 269843
