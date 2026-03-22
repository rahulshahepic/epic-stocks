import sys
import os
import pytest
import openpyxl

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from excel_io import read_all_from_excel, read_grants_from_excel, read_prices_from_excel, read_loans_from_excel
from core import generate_all_events, compute_timeline

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "..", "test_data", "fixture.xlsx")


@pytest.fixture()
def workbook():
    wb = openpyxl.load_workbook(FIXTURE)
    yield wb
    wb.close()


def test_read_grants_count(workbook):
    assert len(read_grants_from_excel(workbook["Schedule"])) == 12


def test_read_prices_count(workbook):
    assert len(read_prices_from_excel(workbook["Prices"])) == 8


def test_read_loans_count(workbook):
    assert len(read_loans_from_excel(workbook["Loans"])) == 21


def test_read_all_initial_price():
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    assert initial_price == prices[0]["price"]
    assert initial_price > 0


def test_grant_fields(workbook):
    g = read_grants_from_excel(workbook["Schedule"])[0]
    assert isinstance(g["year"], int)
    assert isinstance(g["type"], str)
    assert isinstance(g["shares"], int)
    assert isinstance(g["price"], float)
    assert isinstance(g["periods"], int)
    assert g["vest_start"] is not None
    assert g["exercise_date"] is not None


def test_loan_fields(workbook):
    loan = read_loans_from_excel(workbook["Loans"])[0]
    assert isinstance(loan["amount"], float)
    assert isinstance(loan["interest_rate"], float)
    assert loan["loan_type"] in ("Purchase", "Interest", "Tax")
    assert loan["due"] is not None


def test_price_fields(workbook):
    p = read_prices_from_excel(workbook["Prices"])[0]
    assert isinstance(p["price"], float)
    assert p["date"] is not None


def test_roundtrip_generates_correct_events():
    grants, prices, loans, initial_price = read_all_from_excel(FIXTURE)
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)
    assert len(events) == 89
    assert timeline[-1]["cum_shares"] == 571500
