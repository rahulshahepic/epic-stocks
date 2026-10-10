from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from database import get_db
from scaffold.models import User, Price
from schemas import PriceCreate, PriceUpdate, PriceOut
from scaffold.auth import get_current_user
from scaffold.quota import check_row_quota
from app import event_cache
from services.price_state import price_values
from scaffold.crud import apply_update, get_owned, version_conflict

router = APIRouter(prefix="/api/prices", tags=["prices"])


def _refresh_future_payoff_sales(user: User, db: Session) -> None:
    """A price add/edit/delete changes what future payoff sales should be sized
    against; without this they keep selling at whatever price was current
    when they were generated, silently drifting from the account's own latest
    known price."""
    from app.routers.loans import _regenerate_future_payoff_sales
    _regenerate_future_payoff_sales(user, db, create_missing=False)


def _remove_shadowed_estimates(user_id: int, db: Session) -> bool:
    """Delete estimate prices where a real price now exists for the same effective_date."""
    real_dates = {
        row.effective_date
        for row in db.query(Price.effective_date).filter(
            Price.user_id == user_id, Price.is_estimate == False
        )
    }
    if not real_dates:
        return False
    deleted = db.query(Price).filter(
        Price.user_id == user_id,
        Price.is_estimate == True,
        Price.effective_date.in_(real_dates),
    ).delete(synchronize_session=False)
    return deleted > 0


def _cleanup_epic_past_estimates(db: Session) -> int:
    """Estimates remain applicable until explicitly replaced, including in Epic mode."""
    return 0


@router.get("", response_model=list[PriceOut])
def list_prices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()


@router.post("", response_model=PriceOut, status_code=201)
def create_price(body: PriceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        state = price_values(body.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    is_est = state["is_estimate"]
    existing = db.query(Price).filter(
        Price.user_id == user.id, Price.effective_date == body.effective_date,
    ).first()
    # A projection is only a placeholder.  When its date arrives, accepting a
    # reported price must replace that placeholder instead of creating a second
    # row (or rejecting the real observation because of the uniqueness guard).
    if existing is not None and existing.is_estimate and not is_est:
        db.delete(existing)
        db.flush()
    elif existing is not None:
        raise HTTPException(status_code=409, detail="A price already exists for that date")
    check_row_quota(db, Price, user.id)
    price = Price(price=body.price, user_id=user.id, **state)
    db.add(price)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A price already exists for that date") from None
    db.refresh(price)
    _refresh_future_payoff_sales(user, db)
    event_cache.schedule_recompute(user.id)
    return price


@router.get("/{price_id}", response_model=PriceOut)
def get_price(price_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = get_owned(db, Price, price_id, user, "Price")
    return price


@router.put("/{price_id}", response_model=PriceOut)
def update_price(price_id: int, body: PriceUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = get_owned(db, Price, price_id, user, "Price")
    stale = version_conflict(price, body.version)
    if stale:
        return stale
    try:
        state = price_values(body.model_dump(exclude_unset=True), price)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    if state["announced_date"] != price.announced_date:
        price.announcement_notified_at = None
    updates = apply_update(price, body)
    for key, value in state.items():
        setattr(price, key, value)
    if "effective_date" in updates:
        is_est = price.is_estimate
        existing = db.query(Price).filter(
            Price.user_id == user.id,
            Price.effective_date == price.effective_date,
            Price.id != price.id,
        ).first()
        if existing is not None and existing.is_estimate and not is_est:
            db.delete(existing)
            db.flush()
        elif existing is not None:
            db.rollback()
            raise HTTPException(status_code=409, detail="A price already exists for that date")
        price.is_estimate = is_est
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A price already exists for that date") from None
    db.refresh(price)
    _refresh_future_payoff_sales(user, db)
    event_cache.schedule_recompute(user.id)
    return price


@router.delete("/{price_id}", status_code=204)
def delete_price(price_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = get_owned(db, Price, price_id, user, "Price")
    db.delete(price)
    db.commit()
    _refresh_future_payoff_sales(user, db)
    event_cache.schedule_recompute(user.id)
