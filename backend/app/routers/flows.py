import math
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator
from datetime import date

from database import get_db
from scaffold.models import User, Grant, Loan, Price, Sale, TaxSettings
from schemas import GrantOut, LoanOut, PriceOut
from scaffold.auth import get_current_user

router = APIRouter(prefix="/api/flows", tags=["flows"])


class NewPurchaseRequest(BaseModel):
    year: int
    shares: int
    price: float
    vest_start: date
    periods: int
    exercise_date: date
    dp_shares: int = 0
    loan_amount: float | None = None
    loan_rate: float | None = None
    loan_due_date: date | None = None
    loan_number: str | None = None
    generate_payoff_sale: bool = True

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

    @field_validator("loan_amount")
    @classmethod
    def loan_amount_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("loan_amount must be positive")
        return v

    @field_validator("loan_rate")
    @classmethod
    def loan_rate_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("loan_rate cannot be negative")
        return v


class AnnualPriceRequest(BaseModel):
    effective_date: date
    price: float

    @field_validator("price")
    @classmethod
    def price_positive(cls, v):
        if v <= 0:
            raise ValueError("price must be positive")
        return v


class GrowthEstimateRequest(BaseModel):
    base_price: float
    start_date: date
    end_date: date
    annual_rate_pct: float
    frequency: str  # 'annual' | 'quarterly' | 'monthly'

    @field_validator("base_price")
    @classmethod
    def base_price_positive(cls, v):
        if v <= 0:
            raise ValueError("base_price must be positive")
        return v

    @field_validator("annual_rate_pct")
    @classmethod
    def rate_range(cls, v):
        if v < -99 or v > 10000:
            raise ValueError("annual_rate_pct out of range")
        return v

    @field_validator("frequency")
    @classmethod
    def valid_frequency(cls, v):
        if v not in ("annual", "quarterly", "monthly"):
            raise ValueError("frequency must be 'annual', 'quarterly', or 'monthly'")
        return v


class AddBonusRequest(BaseModel):
    year: int
    shares: int
    price: float = 0.0
    vest_start: date
    periods: int
    exercise_date: date
    election_83b: bool = False

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

    @field_validator("periods")
    @classmethod
    def periods_positive(cls, v):
        if v <= 0:
            raise ValueError("periods must be positive")
        return v


def _compute_min_dp(total_purchase: float, ts: TaxSettings | None) -> float:
    """Return the minimum required down-payment amount based on user's DP rules."""
    if ts is None:
        return 0.0
    pct = ts.dp_min_percent if ts.dp_min_percent is not None else 0.10
    cap = ts.dp_min_cap if ts.dp_min_cap is not None else 20000.0
    if pct <= 0 and cap <= 0:
        return 0.0
    return min(pct * total_purchase, cap)


@router.post("/new-purchase", status_code=201)
def new_purchase(body: NewPurchaseRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(Grant).filter(
        Grant.user_id == user.id, Grant.year == body.year, Grant.type == "Purchase"
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"A Purchase grant for {body.year} already exists")

    ts = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    total_purchase = body.shares * body.price
    min_dp = _compute_min_dp(total_purchase, ts)

    dp_shares = body.dp_shares  # negative int or 0
    loan_amount = body.loan_amount

    if ts and ts.prefer_stock_dp and dp_shares == 0 and body.price > 0 and min_dp > 0:
        # Auto-calculate minimum DP in shares (rounded up so we don't undershoot)
        dp_shares = -math.ceil(min_dp / body.price)

    # Adjust loan amount to net of DP when not explicitly provided
    if loan_amount is None and dp_shares < 0 and body.price > 0:
        dp_amount = abs(dp_shares) * body.price
        loan_amount = max(0.0, total_purchase - dp_amount)

    # Validate minimum DP when rules are configured and a purchase loan is being created.
    # Equity = total_purchase - loan_amount (the portion not borrowed, whether via stock DP or cash).
    if min_dp > 0 and loan_amount is not None:
        equity = total_purchase - loan_amount
        if equity < min_dp:
            min_shares = math.ceil(min_dp / body.price) if body.price > 0 else 0
            raise HTTPException(
                status_code=422,
                detail=f"Down payment must be at least ${min_dp:,.2f} "
                       f"(e.g. {min_shares:,} shares at ${body.price:.2f} via stock exchange, "
                       f"or equivalent cash). Equity provided: ${equity:,.2f}.",
            )

    # Validate vested share availability for the DP
    if dp_shares < 0:
        from app.routers.grants import _check_dp_shares, _grants_as_dicts, _load_prices_and_loans
        prices, loans_data = _load_prices_and_loans(user, db)
        existing_grants = _grants_as_dicts(
            db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all()
        )
        _check_dp_shares(dp_shares, body.exercise_date, existing_grants, prices, loans_data)

    grant = Grant(
        user_id=user.id, year=body.year, type="Purchase",
        shares=body.shares, price=body.price,
        vest_start=body.vest_start, periods=body.periods,
        exercise_date=body.exercise_date, dp_shares=dp_shares,
    )
    db.add(grant)

    loan = None
    if loan_amount is not None:
        loan = Loan(
            user_id=user.id, grant_year=body.year, grant_type="Purchase",
            loan_type="Purchase", loan_year=body.year,
            amount=loan_amount, interest_rate=body.loan_rate or 0.0,
            due_date=body.loan_due_date or body.exercise_date,
            loan_number=body.loan_number,
        )
        db.add(loan)

    db.commit()
    db.refresh(grant)

    if loan:
        db.refresh(loan)
        if body.generate_payoff_sale:
            from app.routers.loans import _compute_payoff_sale
            suggestion = _compute_payoff_sale(loan, user, db)
            if suggestion["shares"] > 0 and suggestion["price_per_share"] > 0:
                sale = Sale(
                    user_id=user.id,
                    date=suggestion["date"],
                    shares=suggestion["shares"],
                    price_per_share=suggestion["price_per_share"],
                    loan_id=loan.id,
                    notes=suggestion["notes"],
                )
                db.add(sale)
                db.commit()

    result = {"grant": GrantOut.model_validate(grant)}
    if loan:
        result["loan"] = LoanOut.model_validate(loan)

    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)
    return result


@router.post("/annual-price", response_model=PriceOut, status_code=201)
def annual_price(body: AnnualPriceRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = Price(user_id=user.id, effective_date=body.effective_date, price=body.price)
    db.add(price)
    db.commit()
    db.refresh(price)
    from app.event_cache import schedule_fan_out
    schedule_fan_out()
    return price


@router.post("/growth-estimate", response_model=list[PriceOut], status_code=201)
def growth_estimate(body: GrowthEstimateRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from dateutil.relativedelta import relativedelta

    today = date.today()
    if body.start_date <= today:
        raise HTTPException(status_code=422, detail="start_date must be in the future")
    if body.end_date <= body.start_date:
        raise HTTPException(status_code=422, detail="end_date must be after start_date")

    # Replace any existing prices in the range rather than duplicating them
    db.query(Price).filter(
        Price.user_id == user.id,
        Price.effective_date >= body.start_date,
        Price.effective_date <= body.end_date,
    ).delete(synchronize_session=False)

    delta_map = {
        "annual": relativedelta(years=1),
        "quarterly": relativedelta(months=3),
        "monthly": relativedelta(months=1),
    }
    delta = delta_map[body.frequency]
    rate = body.annual_rate_pct / 100.0
    start = body.start_date

    created: list[Price] = []
    current = start
    while current <= body.end_date:
        years_elapsed = (current - start).days / 365.25
        price_val = round(body.base_price * ((1 + rate) ** years_elapsed), 2)
        p = Price(user_id=user.id, effective_date=current, price=price_val)
        db.add(p)
        created.append(p)
        current = current + delta

    if not created:
        raise HTTPException(status_code=422, detail="No dates generated in range")

    db.commit()
    for p in created:
        db.refresh(p)
    from app.event_cache import schedule_fan_out
    schedule_fan_out()
    return created


@router.post("/add-bonus", response_model=GrantOut, status_code=201)
def add_bonus(body: AddBonusRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = Grant(
        user_id=user.id, year=body.year, type="Bonus",
        shares=body.shares, price=body.price,
        vest_start=body.vest_start, periods=body.periods,
        exercise_date=body.exercise_date, dp_shares=0,
        election_83b=body.election_83b,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)
    from app.event_cache import schedule_recompute
    schedule_recompute(user.id)
    return grant
