"""Import/export endpoints for Excel files."""
import io
import tempfile
from datetime import datetime, date
from openpyxl.comments import Comment
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from models import User, Grant, Loan, Price, Sale
from auth import get_current_user
from excel_io import read_grants_from_excel, read_prices_from_excel, read_loans_from_excel, write_events_to_excel
from core import generate_all_events, compute_timeline
from schemas import LOAN_TYPES

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


# ============================================================
# VALIDATION HELPERS
# ============================================================

def _validate_grant(g: dict, row: int) -> list[str]:
    errors = []
    year = g.get("year")
    if not isinstance(year, (int, float)) or int(year) < 1900 or int(year) > 2100:
        errors.append(f"Row {row}: year must be between 1900 and 2100")
    gtype = g.get("type")
    if not gtype or not str(gtype).strip():
        errors.append(f"Row {row}: type cannot be empty")
    shares = g.get("shares")
    if not isinstance(shares, (int, float)) or int(shares) <= 0:
        errors.append(f"Row {row}: shares must be positive")
    price = g.get("price")
    if not isinstance(price, (int, float)) or float(price) < 0:
        errors.append(f"Row {row}: price cannot be negative")
    periods = g.get("periods")
    if not isinstance(periods, (int, float)) or int(periods) <= 0:
        errors.append(f"Row {row}: periods must be positive")
    # dp_shares can be negative (DP exchange returns shares)
    for field in ("vest_start", "exercise_date"):
        v = g.get(field)
        if v is None:
            errors.append(f"Row {row}: {field} is required")
        else:
            try:
                _to_date(v)
            except Exception:
                errors.append(f"Row {row}: {field} is not a valid date")
    return errors


def _validate_loan(ln: dict, row: int) -> list[str]:
    errors = []
    for yr_field in ("grant_yr", "loan_year"):
        v = ln.get(yr_field)
        try:
            yr = _to_year(v) if v is not None else None
            if yr is None or yr < 1900 or yr > 2100:
                errors.append(f"Row {row}: {yr_field} must be between 1900 and 2100")
        except (ValueError, TypeError):
            errors.append(f"Row {row}: {yr_field} is not a valid year")
    gtype = ln.get("grant_type")
    if not gtype or not str(gtype).strip():
        errors.append(f"Row {row}: grant_type cannot be empty")
    ltype = (ln.get("loan_type") or "").strip()
    if ltype not in LOAN_TYPES:
        errors.append(f"Row {row}: loan_type must be one of {sorted(LOAN_TYPES)}, got '{ltype}'")
    amt = ln.get("amount")
    if not isinstance(amt, (int, float)) or float(amt) <= 0:
        errors.append(f"Row {row}: amount must be positive")
    rate = ln.get("interest_rate")
    if not isinstance(rate, (int, float)) or float(rate) < 0:
        errors.append(f"Row {row}: interest_rate cannot be negative")
    due = ln.get("due")
    if due is None:
        errors.append(f"Row {row}: due_date is required")
    else:
        try:
            _to_date(due)
        except Exception:
            errors.append(f"Row {row}: due_date is not a valid date")
    return errors


def _validate_price(p: dict, row: int) -> list[str]:
    errors = []
    d = p.get("date")
    if d is None:
        errors.append(f"Row {row}: date is required")
    else:
        try:
            _to_date(d)
        except Exception:
            errors.append(f"Row {row}: date is not a valid date")
    price = p.get("price")
    if not isinstance(price, (int, float)) or float(price) <= 0:
        errors.append(f"Row {row}: price must be positive")
    return errors


# ============================================================
# IMPORT (now supports partial — only sheets that exist)
# ============================================================

_MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB
_XLSX_MAGIC = b"PK\x03\x04"  # ZIP/OOXML magic bytes


@router.post("/import/excel", status_code=201)
def import_excel(
    file: UploadFile = File(...),
    generate_payoff_sales: bool = Query(default=False),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="File must be an Excel (.xlsx) file")

    raw = file.file.read(_MAX_UPLOAD_BYTES + 1)
    if len(raw) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")
    if not raw.startswith(_XLSX_MAGIC):
        raise HTTPException(status_code=400, detail="File is not a valid Excel (.xlsx) file")

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=True) as tmp:
        tmp.write(raw)
        tmp.flush()
        try:
            wb = openpyxl.load_workbook(tmp.name)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to open Excel file: {e}")

    sheet_names = [s.lower() for s in wb.sheetnames]

    # Read whichever sheets exist
    grants_raw = []
    prices_raw = []
    loans_raw = []
    has_schedule = "schedule" in sheet_names
    has_prices = "prices" in sheet_names
    has_loans = "loans" in sheet_names

    if not has_schedule and not has_prices and not has_loans:
        wb.close()
        raise HTTPException(
            status_code=400,
            detail="No recognized sheets found. Expected one or more of: Schedule, Prices, Loans"
        )

    try:
        if has_schedule:
            ws_name = wb.sheetnames[[s.lower() for s in wb.sheetnames].index("schedule")]
            grants_raw = read_grants_from_excel(wb[ws_name])
        if has_prices:
            ws_name = wb.sheetnames[[s.lower() for s in wb.sheetnames].index("prices")]
            prices_raw = read_prices_from_excel(wb[ws_name])
        if has_loans:
            ws_name = wb.sheetnames[[s.lower() for s in wb.sheetnames].index("loans")]
            loans_raw = read_loans_from_excel(wb[ws_name])
    except Exception as e:
        wb.close()
        raise HTTPException(status_code=400, detail=f"Failed to parse Excel file: {e}")
    finally:
        wb.close()

    # Validate all rows, collect errors
    all_errors = []
    for i, g in enumerate(grants_raw):
        all_errors.extend(_validate_grant(g, i + 2))
    for i, p in enumerate(prices_raw):
        all_errors.extend(_validate_price(p, i + 2))
    for i, ln in enumerate(loans_raw):
        all_errors.extend(_validate_loan(ln, i + 2))

    if all_errors:
        raise HTTPException(status_code=400, detail="Validation errors:\n" + "\n".join(all_errors))

    # Only wipe data types that were in the uploaded file
    if has_schedule:
        db.query(Grant).filter(Grant.user_id == user.id).delete()
    if has_loans:
        # Remove loan-linked payoff sales first to avoid orphaned loan_id references
        db.query(Sale).filter(Sale.user_id == user.id, Sale.loan_id.isnot(None)).delete()
        db.query(Loan).filter(Loan.user_id == user.id).delete()
    if has_prices:
        db.query(Price).filter(Price.user_id == user.id).delete()

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

    for p in prices_raw:
        db.add(Price(
            user_id=user.id,
            effective_date=_to_date(p["date"]),
            price=p["price"],
        ))

    for ln in loans_raw:
        db.add(Loan(
            user_id=user.id,
            grant_year=_to_year(ln["grant_yr"]),
            grant_type=ln["grant_type"],
            loan_type=ln["loan_type"].strip(),
            loan_year=_to_year(ln["loan_year"]),
            amount=ln["amount"],
            interest_rate=ln["interest_rate"],
            due_date=_to_date(ln["due"]),
            loan_number=str(ln.get("loan_number") or ""),
        ))

    db.commit()

    payoff_sales_created = 0
    if has_loans and generate_payoff_sales:
        from routers.loans import _compute_payoff_sale
        new_loans = db.query(Loan).filter(Loan.user_id == user.id).all()
        for ln in new_loans:
            try:
                suggestion = _compute_payoff_sale(ln, user, db)
                if suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
                    db.add(Sale(
                        user_id=user.id,
                        date=suggestion["date"],
                        shares=suggestion["shares"],
                        price_per_share=suggestion["price_per_share"],
                        loan_id=ln.id,
                        notes=suggestion["notes"],
                    ))
                    payoff_sales_created += 1
            except Exception:
                pass  # best-effort; missing price data etc. silently skipped
        if payoff_sales_created:
            db.commit()

    return {
        "grants": len(grants_raw),
        "prices": len(prices_raw),
        "loans": len(loans_raw),
        "payoff_sales": payoff_sales_created,
        "sheets_imported": [s for s, present in [("Schedule", has_schedule), ("Prices", has_prices), ("Loans", has_loans)] if present],
    }


# ============================================================
# TEMPLATE DOWNLOAD
# ============================================================

@router.get("/import/template")
def download_template():
    """Download an empty Excel template with correct headers and example rows."""
    wb = openpyxl.Workbook()

    # Schedule sheet
    ws = wb.active
    ws.title = "Schedule"
    sched_headers = ["Year", "Type", "Shares", "Price", "Vest Start", "Periods",
                     "", "", "", "", "", "", "", "Exercise Date", "DP Shares"]
    _write_headers(ws, sched_headers)
    # Example row
    _body_cell(ws, 2, 1, 2020)
    _body_cell(ws, 2, 2, "Purchase")
    _body_cell(ws, 2, 3, 10000)
    _body_cell(ws, 2, 4, 5.00, "\\$#,##0.00")
    _body_cell(ws, 2, 5, date(2020, 3, 15), "mm/dd/yyyy")
    _body_cell(ws, 2, 6, 5)
    _body_cell(ws, 2, 14, date(2030, 3, 15), "mm/dd/yyyy")
    _body_cell(ws, 2, 15, 0)
    # Add hints as cell comments on headers (avoids extra rows that break import)
    for col, note in [(1, "e.g. 2020"), (2, "Purchase or Bonus"), (3, "# of shares"),
                      (4, "$ per share"), (5, "mm/dd/yyyy"), (6, "# vesting periods")]:
        ws.cell(row=1, column=col).comment = Comment(note, "Template")

    # Loans sheet
    ws_loans = wb.create_sheet("Loans")
    loan_headers = ["Loan #", "Grant Year", "Grant Type", "Loan Type", "Loan Year",
                    "Amount", "Rate", "Due Date"]
    _write_headers(ws_loans, loan_headers)
    _body_cell(ws_loans, 2, 1, "L001")
    _body_cell(ws_loans, 2, 2, 2020)
    _body_cell(ws_loans, 2, 3, "Purchase")
    _body_cell(ws_loans, 2, 4, "Interest")
    _body_cell(ws_loans, 2, 5, 2020)
    _body_cell(ws_loans, 2, 6, 5000.00, "\\$#,##0.00")
    _body_cell(ws_loans, 2, 7, 0.05, "0.00%")
    _body_cell(ws_loans, 2, 8, date(2025, 3, 15), "mm/dd/yyyy")
    for col, note in [(3, "Purchase or Bonus"), (4, "Interest, Tax, Principal, or Purchase"),
                      (7, "decimal, e.g. 0.05 = 5%")]:
        ws_loans.cell(row=1, column=col).comment = Comment(note, "Template")

    # Prices sheet
    ws_prices = wb.create_sheet("Prices")
    _write_headers(ws_prices, ["Date", "Price"])
    _body_cell(ws_prices, 2, 1, date(2020, 1, 1), "mm/dd/yyyy")
    _body_cell(ws_prices, 2, 2, 5.00, "\\$#,##0.00")
    ws_prices.cell(row=1, column=1).comment = Comment("One row per annual price update", "Template")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Vesting_Template.xlsx"},
    )


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
