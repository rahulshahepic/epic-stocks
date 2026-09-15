import math
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import date, date as date_cls

from database import get_db
from scaffold.models import User, Grant, Loan, Price, TaxSettings, GrantProgramSettings
from schemas import (
    InputModel, GrantOut, LoanOut, PriceOut, GrowthPriceRequest,
    Year, Shares, Price as PositivePrice, CostBasis, Periods,
    DownPaymentShares, Money, InterestRate, LoanNumber, PayoffSaleOptions,
)
from scaffold.auth import get_current_user
from scaffold.quota import check_row_quota
from app import event_cache

router = APIRouter(prefix="/api/flows", tags=["flows"])


class NewPurchaseRequest(InputModel):
    year: Year
    shares: Shares
    price: CostBasis
    vest_start: date
    periods: Periods
    exercise_date: date
    dp_shares: DownPaymentShares = 0
    loan_amount: Money | None = None
    loan_rate: InterestRate | None = None
    loan_due_date: date | None = None
    loan_number: LoanNumber | None = None
    generate_payoff_sale: bool = True
    payoff_sale: PayoffSaleOptions | None = None


class AnnualPriceRequest(InputModel):
    effective_date: date
    price: PositivePrice


class AddBonusRequest(InputModel):
    year: Year
    shares: Shares
    price: CostBasis = 0.0
    vest_start: date
    periods: Periods
    exercise_date: date
    election_83b: bool = False



def _compute_min_dp(total_purchase: float, settings: GrantProgramSettings | None) -> float:
    """Return the minimum required down-payment amount from company-wide DP policy."""
    pct = settings.dp_min_percent if settings is not None else 0.10
    cap = settings.dp_min_cap if settings is not None else 20000.0
    if pct <= 0 and cap <= 0:
        return 0.0
    return min(pct * total_purchase, cap)


@router.post("/new-purchase", status_code=201)
def new_purchase(body: NewPurchaseRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # The natural key check and insert belong to one serialized operation.
    db.query(User).filter(User.id == user.id).with_for_update().first()
    existing = db.query(Grant).filter(
        Grant.user_id == user.id, Grant.year == body.year, Grant.type == "Purchase"
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"A Purchase grant for {body.year} already exists")

    ts = db.query(TaxSettings).filter(TaxSettings.user_id == user.id).first()
    program_settings = db.query(GrantProgramSettings).filter(GrantProgramSettings.id == 1).one_or_none()
    total_purchase = body.shares * body.price
    min_dp = _compute_min_dp(total_purchase, program_settings)

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

    check_row_quota(db, Grant, user.id)
    grant = Grant(
        user_id=user.id, year=body.year, type="Purchase",
        shares=body.shares, price=body.price,
        vest_start=body.vest_start, periods=body.periods,
        exercise_date=body.exercise_date, dp_shares=dp_shares,
    )
    db.add(grant)

    loan = None
    if loan_amount is not None and loan_amount > 0:
        check_row_quota(db, Loan, user.id)
        loan = Loan(
            user_id=user.id, grant_year=body.year, grant_type="Purchase",
            loan_type="Purchase", loan_year=body.year,
            amount=loan_amount, interest_rate=body.loan_rate or 0.0,
            due_date=body.loan_due_date or body.exercise_date,
            loan_number=body.loan_number,
        )
        db.add(loan)

    # Flush assigns ids and makes the new rows visible to the payoff calculator;
    # the final commit remains atomic with the generated sale.
    db.flush()
    if loan:
        payoff = body.payoff_sale
        enabled = payoff.enabled if payoff is not None else body.generate_payoff_sale
        if enabled:
            from app.routers.loans import _upsert_generated_payoff_sale
            _upsert_generated_payoff_sale(loan, user, db, payoff)

    db.commit()
    db.refresh(grant)
    if loan:
        db.refresh(loan)

    result = {"grant": GrantOut.model_validate(grant)}
    if loan:
        result["loan"] = LoanOut.model_validate(loan)

    event_cache.schedule_recompute(user.id)
    return result


@router.post("/annual-price", response_model=PriceOut, status_code=201)
def annual_price(body: AnnualPriceRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from scaffold.epic_mode import is_epic_mode
    is_est = body.effective_date > date_cls.today()
    if is_epic_mode() and not is_est:
        raise HTTPException(status_code=422, detail="Only future-dated prices can be added in Epic mode")
    existing = db.query(Price).filter(
        Price.user_id == user.id, Price.effective_date == body.effective_date,
    ).first()
    if existing is not None and existing.is_estimate and not is_est:
        db.delete(existing)
        db.flush()
    elif existing is not None:
        raise HTTPException(status_code=409, detail="A price already exists for that date")
    check_row_quota(db, Price, user.id)
    price = Price(user_id=user.id, effective_date=body.effective_date, price=body.price, is_estimate=is_est)
    db.add(price)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A price already exists for that date") from None
    db.refresh(price)
    # Future payoff sales were sized against whatever price was current when
    # they were generated; a new price point can make that stale, so refresh
    # them now rather than leaving them selling at an outdated price.
    from app.routers.loans import _regenerate_future_payoff_sales
    _regenerate_future_payoff_sales(user, db, create_missing=False)
    event_cache.schedule_recompute(user.id)
    return price


@router.post("/growth-price", response_model=list[PriceOut], status_code=201)
def growth_price(body: GrowthPriceRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.first_date <= date_cls.today():
        raise HTTPException(status_code=422, detail="first_date must be in the future")
    base = (
        db.query(Price)
        .filter(Price.user_id == user.id, Price.is_estimate == False)
        .order_by(Price.effective_date.desc())
        .first()
    )
    if not base:
        raise HTTPException(status_code=422, detail="No historical price found to base growth on")

    # Delete existing estimates in the requested range
    db.query(Price).filter(
        Price.user_id == user.id,
        Price.is_estimate == True,
        Price.effective_date >= body.first_date,
        Price.effective_date <= body.through_date,
    ).delete(synchronize_session=False)

    projection_dates: list[date] = []
    current_date = body.first_date
    while current_date <= body.through_date:
        projection_dates.append(current_date)
        current_date = current_date + relativedelta(years=1)
    real_dates = {
        row.effective_date for row in db.query(Price).filter(
            Price.user_id == user.id,
            Price.is_estimate == False,
            Price.effective_date.in_(projection_dates),
        ).all()
    }
    check_row_quota(db, Price, user.id, adding=len(projection_dates) - len(real_dates))

    multiplier = 1 + body.annual_growth_pct / 100
    entries: list[Price] = []
    current_price = round(base.price * multiplier, 2)
    for current_date in projection_dates:
        if current_date in real_dates:
            current_price = round(current_price * multiplier, 2)
            continue
        p = Price(user_id=user.id, effective_date=current_date, price=current_price, is_estimate=True)
        db.add(p)
        entries.append(p)
        current_price = round(current_price * multiplier, 2)

    db.commit()
    for p in entries:
        db.refresh(p)
    # Same as annual_price: refresh future payoff sales against the new prices.
    from app.routers.loans import _regenerate_future_payoff_sales
    _regenerate_future_payoff_sales(user, db, create_missing=False)
    event_cache.schedule_recompute(user.id)
    return entries


@router.post("/add-bonus", response_model=GrantOut, status_code=201)
def add_bonus(body: AddBonusRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(User).filter(User.id == user.id).with_for_update().first()
    if db.query(Grant.id).filter(Grant.user_id == user.id, Grant.year == body.year, Grant.type == "Bonus").first():
        raise HTTPException(status_code=409, detail=f"A Bonus grant for {body.year} already exists")
    check_row_quota(db, Grant, user.id)
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
    event_cache.schedule_recompute(user.id)
    return grant
