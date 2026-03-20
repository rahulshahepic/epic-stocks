from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import date

from database import get_db
from models import User, Grant, Loan, Price
from schemas import GrantOut, LoanOut, PriceOut
from auth import get_current_user

router = APIRouter(prefix="/api/flows", tags=["flows"])


class NewPurchaseRequest(BaseModel):
    year: int
    shares: int
    price: float
    vest_start: date
    periods: int
    exercise_date: date
    dp_shares: int = 0
    # Optional loan
    loan_amount: float | None = None
    loan_rate: float | None = None
    loan_due_date: date | None = None
    loan_number: str | None = None


class AnnualPriceRequest(BaseModel):
    effective_date: date
    price: float


class AddBonusRequest(BaseModel):
    year: int
    shares: int
    price: float = 0.0
    vest_start: date
    periods: int
    exercise_date: date


@router.post("/new-purchase", status_code=201)
def new_purchase(body: NewPurchaseRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = Grant(
        user_id=user.id, year=body.year, type="Purchase",
        shares=body.shares, price=body.price,
        vest_start=body.vest_start, periods=body.periods,
        exercise_date=body.exercise_date, dp_shares=body.dp_shares,
    )
    db.add(grant)
    db.flush()

    result = {"grant": GrantOut.model_validate(grant)}
    loan = None

    if body.loan_amount is not None:
        loan = Loan(
            user_id=user.id, grant_year=body.year, grant_type="Purchase",
            loan_type="Purchase", loan_year=body.year,
            amount=body.loan_amount, interest_rate=body.loan_rate or 0.0,
            due_date=body.loan_due_date or body.exercise_date,
            loan_number=body.loan_number,
        )
        db.add(loan)
        db.flush()
        result["loan"] = LoanOut.model_validate(loan)

    db.commit()
    db.refresh(grant)
    result["grant"] = GrantOut.model_validate(grant)
    if loan:
        db.refresh(loan)
        result["loan"] = LoanOut.model_validate(loan)

    return result


@router.post("/annual-price", response_model=PriceOut, status_code=201)
def annual_price(body: AnnualPriceRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = Price(user_id=user.id, effective_date=body.effective_date, price=body.price)
    db.add(price)
    db.commit()
    db.refresh(price)
    return price


@router.post("/add-bonus", response_model=GrantOut, status_code=201)
def add_bonus(body: AddBonusRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = Grant(
        user_id=user.id, year=body.year, type="Bonus",
        shares=body.shares, price=body.price,
        vest_start=body.vest_start, periods=body.periods,
        exercise_date=body.exercise_date, dp_shares=0,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return grant
