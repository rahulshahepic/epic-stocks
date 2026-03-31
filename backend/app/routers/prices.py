from datetime import date as date_cls
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, Price
from schemas import PriceCreate, PriceUpdate, PriceOut
from scaffold.auth import get_current_user

router = APIRouter(prefix="/api/prices", tags=["prices"])


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
    if is_epic_mode():
        deleted = db.query(Price).filter(
            Price.user_id == user.id,
            Price.is_estimate == True,
            Price.effective_date < date_cls.today(),
        ).delete(synchronize_session=False)
        if deleted:
            db.commit()
            from app.event_cache import schedule_fan_out
            schedule_fan_out()
    return db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()


@router.post("", response_model=PriceOut, status_code=201)
def create_price(body: PriceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    is_est = body.effective_date > date_cls.today()
    price = Price(**body.model_dump(), user_id=user.id, is_estimate=is_est)
    db.add(price)
    db.flush()
    if not is_est:
        _remove_shadowed_estimates(user.id, db)
    db.commit()
    db.refresh(price)
    from app.event_cache import schedule_fan_out
    schedule_fan_out()
    return price


@router.get("/{price_id}", response_model=PriceOut)
def get_price(price_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = db.query(Price).filter(Price.id == price_id, Price.user_id == user.id).first()
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")
    return price


@router.put("/{price_id}", response_model=PriceOut)
def update_price(price_id: int, body: PriceUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = db.query(Price).filter(Price.id == price_id, Price.user_id == user.id).first()
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")
    submitted_version = body.version
    if submitted_version is not None and price.version != submitted_version:
        return JSONResponse(
            status_code=409,
            content={"detail": "modified_elsewhere", "current_version": price.version},
        )
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "version"}
    for k, v in updates.items():
        setattr(price, k, v)
    if "effective_date" in updates:
        price.is_estimate = price.effective_date > date_cls.today()
        if not price.is_estimate:
            _remove_shadowed_estimates(user.id, db)
    price.version = price.version + 1
    db.commit()
    db.refresh(price)
    from app.event_cache import schedule_fan_out
    schedule_fan_out()
    return price


@router.delete("/{price_id}", status_code=204)
def delete_price(price_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = db.query(Price).filter(Price.id == price_id, Price.user_id == user.id).first()
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")
    db.delete(price)
    db.commit()
    from app.event_cache import schedule_fan_out
    schedule_fan_out()
