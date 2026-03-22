from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from models import User, Grant, Loan, Price
from schemas import GrantCreate, GrantUpdate, GrantOut
from auth import get_current_user

router = APIRouter(prefix="/api/grants", tags=["grants"])


def _check_dp_shares(dp_shares: int, exercise_date, user: User, db: Session, exclude_grant_id: int | None = None):
    """
    Validate that enough vested shares exist one day before exercise_date to cover dp_shares.
    dp_shares is stored as a negative integer; we check abs(dp_shares).
    Skipped if dp_shares is 0 or positive (no DP).
    """
    if not dp_shares or dp_shares >= 0:
        return

    from core import generate_all_events, compute_timeline
    from sales_engine import build_fifo_lots

    grants_db = db.query(Grant).filter(Grant.user_id == user.id)
    if exclude_grant_id is not None:
        grants_db = grants_db.filter(Grant.id != exclude_grant_id)
    grants_db = grants_db.order_by(Grant.year).all()

    prices_db = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()
    loans_db = db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.due_date).all()

    grants = [{
        "year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
        "vest_start": datetime.combine(g.vest_start, datetime.min.time()),
        "periods": g.periods,
        "exercise_date": datetime.combine(g.exercise_date, datetime.min.time()),
        "dp_shares": g.dp_shares or 0,
    } for g in grants_db]
    prices = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price} for p in prices_db]
    loans = [{
        "grant_yr": ln.grant_year, "grant_type": ln.grant_type,
        "loan_type": ln.loan_type, "loan_year": ln.loan_year,
        "amount": ln.amount, "interest_rate": ln.interest_rate,
        "due": datetime.combine(ln.due_date, datetime.min.time()),
        "loan_number": ln.loan_number,
    } for ln in loans_db]

    if not grants or not prices:
        return  # can't validate without a timeline

    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, prices[0]["price"])

    # Check one day before exercise_date so we exclude any same-day DP exchanges
    ex_date = exercise_date.date() if isinstance(exercise_date, datetime) else exercise_date
    check_date = ex_date - timedelta(days=1)

    lots = build_fifo_lots(timeline, check_date, order='fifo')
    available = sum(l[1] for l in lots)

    if available < abs(dp_shares):
        raise HTTPException(
            status_code=422,
            detail=f"Insufficient vested shares for down payment: {abs(dp_shares):,} required, "
                   f"only {available:,} vested before {ex_date}",
        )


@router.get("", response_model=list[GrantOut])
def list_grants(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all()


@router.post("", response_model=GrantOut, status_code=201)
def create_grant(body: GrantCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(Grant).filter(
        Grant.user_id == user.id, Grant.year == body.year, Grant.type == body.type
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"A {body.type} grant for {body.year} already exists")
    _check_dp_shares(body.dp_shares, body.exercise_date, user, db)
    grant = Grant(**body.model_dump(), user_id=user.id)
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return grant


@router.post("/bulk", response_model=list[GrantOut], status_code=201)
def bulk_create_grants(items: list[GrantCreate], user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grants = [Grant(**g.model_dump(), user_id=user.id) for g in items]
    db.add_all(grants)
    db.commit()
    for g in grants:
        db.refresh(g)
    return grants


@router.get("/{grant_id}", response_model=GrantOut)
def get_grant(grant_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = db.query(Grant).filter(Grant.id == grant_id, Grant.user_id == user.id).first()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")
    return grant


@router.put("/{grant_id}", response_model=GrantOut)
def update_grant(grant_id: int, body: GrantUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = db.query(Grant).filter(Grant.id == grant_id, Grant.user_id == user.id).first()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")
    submitted_version = body.version
    if submitted_version is not None and grant.version != submitted_version:
        return JSONResponse(
            status_code=409,
            content={"detail": "modified_elsewhere", "current_version": grant.version},
        )
    new_year = body.year if body.year is not None else grant.year
    new_type = body.type if body.type is not None else grant.type
    conflict = db.query(Grant).filter(
        Grant.user_id == user.id, Grant.year == new_year, Grant.type == new_type, Grant.id != grant_id
    ).first()
    if conflict:
        raise HTTPException(status_code=409, detail=f"A {new_type} grant for {new_year} already exists")
    new_dp = body.dp_shares if body.dp_shares is not None else grant.dp_shares
    new_exercise = body.exercise_date if body.exercise_date is not None else grant.exercise_date
    _check_dp_shares(new_dp, new_exercise, user, db, exclude_grant_id=grant_id)
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}
    for k, v in updates.items():
        setattr(grant, k, v)
    grant.version = grant.version + 1
    db.commit()
    db.refresh(grant)
    return grant


@router.delete("/{grant_id}", status_code=204)
def delete_grant(grant_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    grant = db.query(Grant).filter(Grant.id == grant_id, Grant.user_id == user.id).first()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant not found")
    db.delete(grant)
    db.commit()
