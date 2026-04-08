"""Wizard endpoints: tolerant structural file parsing and atomic bulk data creation."""
import io
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
import openpyxl

from database import get_db
from scaffold.models import User, Grant, Loan, Price, Sale, LoanPayment
from scaffold.auth import get_current_user
from app.date_utils import to_date as _to_date

router = APIRouter(prefix="/api/wizard", tags=["wizard"])


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_int(v):
    try:
        return int(v) if v is not None else None
    except (ValueError, TypeError):
        return None


def _safe_float(v):
    try:
        return float(v) if v is not None else None
    except (ValueError, TypeError):
        return None


def _safe_date(v) -> str | None:
    if v is None:
        return None
    try:
        return _to_date(v).isoformat()
    except Exception:
        return None


# ── Parse file (tolerant — missing numbers are fine) ─────────────────────────

class ParsedGrantTemplate(BaseModel):
    year: int | None = None
    type: str | None = None
    periods: int | None = None
    vest_start: str | None = None
    exercise_date: str | None = None
    price: float | None = None


class ParsedPrice(BaseModel):
    effective_date: str
    price: float | None = None


class ParseFileResponse(BaseModel):
    grants: list[ParsedGrantTemplate]
    prices: list[ParsedPrice]


@router.post("/parse-file", response_model=ParseFileResponse)
def parse_file(
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    """Parse a structural xlsx file tolerantly — missing share counts and amounts are fine."""
    content = file.file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        raise HTTPException(status_code=422, detail="Could not parse file as Excel (.xlsx)")

    grants: list[ParsedGrantTemplate] = []
    if "Schedule" in wb.sheetnames:
        ws = wb["Schedule"]
        for i in range(2, 100):
            yr = ws.cell(row=i, column=1).value
            if yr is None:
                break
            grants.append(ParsedGrantTemplate(
                year=_safe_int(yr),
                type=str(ws.cell(row=i, column=2).value or "").strip() or None,
                periods=_safe_int(ws.cell(row=i, column=6).value),
                vest_start=_safe_date(ws.cell(row=i, column=5).value),
                exercise_date=_safe_date(ws.cell(row=i, column=7).value),
                price=_safe_float(ws.cell(row=i, column=4).value),
            ))

    prices: list[ParsedPrice] = []
    if "Prices" in wb.sheetnames:
        ws = wb["Prices"]
        for i in range(2, 30):
            d = ws.cell(row=i, column=1).value
            if d is None:
                break
            date_str = _safe_date(d)
            if date_str:
                prices.append(ParsedPrice(
                    effective_date=date_str,
                    price=_safe_float(ws.cell(row=i, column=2).value),
                ))

    return ParseFileResponse(grants=grants, prices=prices)


# ── Submit ────────────────────────────────────────────────────────────────────

class WizardLoan(BaseModel):
    loan_number: str = ""
    loan_type: str  # "Purchase" or "Tax"
    loan_year: int
    amount: float
    interest_rate: float
    due_date: str
    refinances_loan_number: str = ""

    @field_validator("loan_type")
    @classmethod
    def valid_loan_type(cls, v):
        if v not in ("Purchase", "Tax", "Interest"):
            raise ValueError("loan_type must be Purchase, Tax, or Interest")
        return v

    @field_validator("amount")
    @classmethod
    def amount_positive(cls, v):
        if v <= 0:
            raise ValueError("amount must be positive")
        return v

    @field_validator("interest_rate")
    @classmethod
    def rate_non_negative(cls, v):
        if v < 0:
            raise ValueError("interest_rate cannot be negative")
        return v


class WizardGrant(BaseModel):
    year: int
    type: str  # Purchase | Catch-Up | Bonus | Free
    shares: int
    price: float
    vest_start: str
    periods: int
    exercise_date: str
    dp_shares: int = 0
    election_83b: bool = False
    loans: list[WizardLoan] = []

    @field_validator("year")
    @classmethod
    def year_range(cls, v):
        if v < 1900 or v > 2100:
            raise ValueError("year must be between 1900 and 2100")
        return v

    @field_validator("shares")
    @classmethod
    def shares_positive(cls, v):
        if v <= 0:
            raise ValueError("shares must be positive")
        return v

    @field_validator("price")
    @classmethod
    def price_non_negative(cls, v):
        if v < 0:
            raise ValueError("price cannot be negative")
        return v

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v):
        if v <= 0:
            raise ValueError("periods must be positive")
        return v


class WizardPrice(BaseModel):
    effective_date: str
    price: float

    @field_validator("price")
    @classmethod
    def price_positive(cls, v):
        if v <= 0:
            raise ValueError("price must be positive")
        return v


class WizardSubmitRequest(BaseModel):
    grants: list[WizardGrant]
    prices: list[WizardPrice]
    clear_existing: bool = True
    generate_payoff_sales: bool = True


class WizardSubmitResponse(BaseModel):
    grants: int
    loans: int
    prices: int
    payoff_sales: int


@router.post("/submit", response_model=WizardSubmitResponse, status_code=201)
def submit(
    body: WizardSubmitRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Atomically replace user data with wizard-collected grants, loans, and prices."""
    if body.clear_existing:
        db.query(LoanPayment).filter(LoanPayment.user_id == user.id).delete()
        db.query(Sale).filter(Sale.user_id == user.id).delete()
        db.query(Grant).filter(Grant.user_id == user.id).delete()
        db.query(Loan).filter(Loan.user_id == user.id).delete()
        db.query(Price).filter(Price.user_id == user.id).delete()

    # Prices
    price_count = 0
    for p in body.prices:
        db.add(Price(
            user_id=user.id,
            effective_date=_to_date(p.effective_date),
            price=p.price,
            is_estimate=_to_date(p.effective_date) > date.today(),
        ))
        price_count += 1

    # Grants
    grant_count = 0
    for g in body.grants:
        db.add(Grant(
            user_id=user.id,
            year=g.year,
            type=g.type,
            shares=g.shares,
            price=g.price,
            vest_start=_to_date(g.vest_start),
            periods=g.periods,
            exercise_date=_to_date(g.exercise_date),
            dp_shares=g.dp_shares,
            election_83b=g.election_83b,
        ))
        grant_count += 1

    db.flush()

    # Loans — two-pass to resolve refinance references by loan_number
    loan_objects: list[tuple[Loan, str]] = []  # (loan_obj, refinances_loan_number)
    loan_by_number: dict[str, Loan] = {}
    loan_count = 0

    for g in body.grants:
        for wl in g.loans:
            loan = Loan(
                user_id=user.id,
                grant_year=g.year,
                grant_type=g.type,
                loan_type=wl.loan_type,
                loan_year=wl.loan_year,
                amount=wl.amount,
                interest_rate=wl.interest_rate,
                due_date=_to_date(wl.due_date),
                loan_number=wl.loan_number or None,
            )
            db.add(loan)
            loan_objects.append((loan, wl.refinances_loan_number))
            if wl.loan_number:
                loan_by_number[wl.loan_number] = loan
            loan_count += 1

    db.flush()

    for loan, ref_num in loan_objects:
        if ref_num and ref_num in loan_by_number:
            loan.refinances_loan_id = loan_by_number[ref_num].id

    db.flush()

    # Payoff sales for Purchase loans
    payoff_count = 0
    if body.generate_payoff_sales:
        from app.routers.loans import _compute_payoff_sale
        for loan, _ in loan_objects:
            if loan.loan_type == "Purchase":
                try:
                    suggestion = _compute_payoff_sale(loan, user, db)
                    if suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
                        db.add(Sale(
                            user_id=user.id,
                            date=suggestion["date"],
                            shares=suggestion["shares"],
                            price_per_share=suggestion["price_per_share"],
                            loan_id=loan.id,
                            notes=suggestion["notes"],
                        ))
                        payoff_count += 1
                except Exception:
                    pass  # Don't abort the whole wizard if payoff calc fails

    db.commit()

    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)

    return WizardSubmitResponse(
        grants=grant_count,
        loans=loan_count,
        prices=price_count,
        payoff_sales=payoff_count,
    )
