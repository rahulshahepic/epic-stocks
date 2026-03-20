"""Import/export endpoints for Excel files."""
import io
import tempfile
from datetime import datetime, date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from models import User, Grant, Loan, Price
from auth import get_current_user
from excel_io import read_all_from_excel, write_events_to_excel
from core import generate_all_events, compute_timeline

import openpyxl
from openpyxl.styles import Font, PatternFill

router = APIRouter(prefix="/api", tags=["import_export"])


def _to_date(val) -> date:
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    return datetime.strptime(str(val), "%Y-%m-%d").date()


def _to_year(val) -> int:
    """Convert a value that might be a date or int to a year integer."""
    if isinstance(val, (datetime, date)):
        return val.year
    return int(val)


@router.post("/import/excel", status_code=201)
def import_excel(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be an Excel (.xlsx) file")

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=True) as tmp:
        tmp.write(file.file.read())
        tmp.flush()
        try:
            grants_raw, prices_raw, loans_raw, _ = read_all_from_excel(tmp.name)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {e}")

    # Wipe existing data for this user
    db.query(Grant).filter(Grant.user_id == user.id).delete()
    db.query(Loan).filter(Loan.user_id == user.id).delete()
    db.query(Price).filter(Price.user_id == user.id).delete()

    # Insert grants
    for g in grants_raw:
        db.add(Grant(
            user_id=user.id,
            year=g["year"],
            type=g["type"],
            shares=g["shares"],
            price=g["price"],
            vest_start=_to_date(g["vest_start"]),
            periods=g["periods"],
            exercise_date=_to_date(g["exercise_date"]),
            dp_shares=g.get("dp_shares", 0),
        ))

    # Insert prices
    for p in prices_raw:
        db.add(Price(
            user_id=user.id,
            effective_date=_to_date(p["date"]),
            price=p["price"],
        ))

    # Insert loans
    for ln in loans_raw:
        db.add(Loan(
            user_id=user.id,
            grant_year=_to_year(ln["grant_yr"]),
            grant_type=ln["grant_type"],
            loan_type=ln["loan_type"],
            loan_year=_to_year(ln["loan_year"]),
            amount=ln["amount"],
            interest_rate=ln["interest_rate"],
            due_date=_to_date(ln["due"]),
            loan_number=str(ln.get("loan_number") or ""),
        ))

    db.commit()

    return {
        "grants": len(grants_raw),
        "prices": len(prices_raw),
        "loans": len(loans_raw),
    }


# ============================================================
# EXPORT
# ============================================================

_SCHED_HEADERS = ["Year", "Type", "Shares", "Price", "Vest Start", "Periods",
                   "", "", "", "", "", "", "", "Exercise Date", "DP Shares"]
_LOAN_HEADERS = ["Loan #", "Grant Year", "Grant Type", "Loan Type", "Loan Year",
                  "Amount", "Rate", "Due Date"]
_PRICE_HEADERS = ["Date", "Price"]
_EVENT_HEADERS = ["Date", "Grant Year", "Grant Type", "Event Type",
                  "Granted Shares", "Grant Price", "Exercise Price",
                  "Vested Shares", "Cum Shares", "Price Increase",
                  "Share Price", "Income", "Cum Income",
                  "Cap Gains", "Price Cap Gains", "Total Cap Gains", "Cum Cap Gains"]

_HEADER_FILL = PatternFill("solid", fgColor="FF4472C4")
_HEADER_FONT = Font(name="Arial", size=10, bold=True, color="FFFFFFFF")
_BODY_FONT = Font(name="Arial", size=10)
_ALT_FILL = PatternFill("solid", fgColor="FFE8E7FC")
_WHITE_FILL = PatternFill("solid", fgColor="FFFFFFFF")


def _write_headers(ws, headers):
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=1, column=i, value=h)
        c.fill = _HEADER_FILL
        c.font = _HEADER_FONT


def _body_cell(ws, row, col, val, fmt=None):
    c = ws.cell(row=row, column=col, value=val)
    c.font = _BODY_FONT
    c.fill = _ALT_FILL if row % 2 == 0 else _WHITE_FILL
    if fmt:
        c.number_format = fmt


@router.get("/export/excel")
def export_excel(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    grants_db = db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all()
    loans_db = db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.due_date).all()
    prices_db = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()

    wb = openpyxl.Workbook()

    # -- Schedule sheet --
    ws_sched = wb.active
    ws_sched.title = "Schedule"
    _write_headers(ws_sched, _SCHED_HEADERS)
    for i, g in enumerate(grants_db, 2):
        _body_cell(ws_sched, i, 1, g.year)
        _body_cell(ws_sched, i, 2, g.type)
        _body_cell(ws_sched, i, 3, g.shares, "#,##0")
        _body_cell(ws_sched, i, 4, g.price, "\\$#,##0.00")
        _body_cell(ws_sched, i, 5, g.vest_start, "mm/dd/yyyy")
        _body_cell(ws_sched, i, 6, g.periods)
        _body_cell(ws_sched, i, 14, g.exercise_date, "mm/dd/yyyy")
        _body_cell(ws_sched, i, 15, g.dp_shares, "#,##0")

    # -- Loans sheet --
    ws_loans = wb.create_sheet("Loans")
    _write_headers(ws_loans, _LOAN_HEADERS)
    for i, ln in enumerate(loans_db, 2):
        _body_cell(ws_loans, i, 1, ln.loan_number)
        _body_cell(ws_loans, i, 2, ln.grant_year)
        _body_cell(ws_loans, i, 3, ln.grant_type)
        _body_cell(ws_loans, i, 4, ln.loan_type)
        _body_cell(ws_loans, i, 5, ln.loan_year)
        _body_cell(ws_loans, i, 6, ln.amount, "\\$#,##0.00")
        _body_cell(ws_loans, i, 7, ln.interest_rate, "0.00%")
        _body_cell(ws_loans, i, 8, ln.due_date, "mm/dd/yyyy")

    # -- Prices sheet --
    ws_prices = wb.create_sheet("Prices")
    _write_headers(ws_prices, _PRICE_HEADERS)
    for i, p in enumerate(prices_db, 2):
        _body_cell(ws_prices, i, 1, p.effective_date, "mm/dd/yyyy")
        _body_cell(ws_prices, i, 2, p.price, "\\$#,##0.00")

    # -- Events sheet (use existing writer for formulas) --
    ws_events = wb.create_sheet("Events")
    _write_headers(ws_events, _EVENT_HEADERS)

    # Generate events for formula-based writing
    grants_dicts = [{
        "year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
        "vest_start": datetime.combine(g.vest_start, datetime.min.time()),
        "periods": g.periods,
        "exercise_date": datetime.combine(g.exercise_date, datetime.min.time()),
        "dp_shares": g.dp_shares or 0,
    } for g in grants_db]

    prices_dicts = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price} for p in prices_db]

    loans_dicts = [{
        "grant_yr": ln.grant_year, "grant_type": ln.grant_type,
        "loan_type": ln.loan_type, "loan_year": ln.loan_year,
        "amount": ln.amount, "interest_rate": ln.interest_rate,
        "due": datetime.combine(ln.due_date, datetime.min.time()),
        "loan_number": ln.loan_number,
    } for ln in loans_db]

    if grants_dicts or prices_dicts:
        events = generate_all_events(grants_dicts, prices_dicts, loans_dicts)
        initial_price = prices_dicts[0]["price"] if prices_dicts else 0
        timeline = compute_timeline(events, initial_price)

        # Save to temp file so write_events_to_excel can open it
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp_path = tmp.name
            wb.save(tmp_path)

        write_events_to_excel(tmp_path, timeline, prices_dicts)

        # Re-read the file with events written
        import os
        with open(tmp_path, "rb") as f:
            content = f.read()
        os.unlink(tmp_path)
    else:
        buf = io.BytesIO()
        wb.save(buf)
        content = buf.getvalue()

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Vesting.xlsx"},
    )
