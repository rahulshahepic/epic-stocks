from datetime import date as date_cls
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Price
from schemas import PriceCreate, PriceUpdate, PriceOut
from scaffold.auth import get_current_user
from scaffold.quota import check_row_quota
from app import event_cache
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
    """In Epic mode, delete estimate prices whose effective_date has passed. Returns count deleted."""
    from scaffold.epic_mode import is_epic_mode
    if not is_epic_mode():
        return 0
    deleted = db.query(Price).filter(
        Price.is_estimate == True,
        Price.effective_date < date_cls.today(),
    ).delete(synchronize_session=False)
    if deleted:
        db.commit()
    return deleted


@router.get("", response_model=list[PriceOut])
def list_prices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from scaffold.epic_mode import is_epic_mode
    # Remove estimates that are now shadowed by a real price for the same date.
    shadow_deleted = _remove_shadowed_estimates(user.id, db)
    # In Epic mode also remove past estimates (Epic's systems supply the real prices).
    epic_deleted = 0
    if is_epic_mode():
        epic_deleted = db.query(Price).filter(
            Price.user_id == user.id,
            Price.is_estimate == True,
            Price.effective_date < date_cls.today(),
        ).delete(synchronize_session=False)
    if shadow_deleted or epic_deleted:
        db.commit()
        event_cache.schedule_recompute(user.id)
    return db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()


@router.post("", response_model=PriceOut, status_code=201)
def create_price(body: PriceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    check_row_quota(db, Price, user.id)
    is_est = body.effective_date > date_cls.today()
    price = Price(**body.model_dump(), user_id=user.id, is_estimate=is_est)
    db.add(price)
    db.commit()
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
    updates = apply_update(price, body)
    if "effective_date" in updates:
        price.is_estimate = price.effective_date > date_cls.today()
    db.commit()
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
