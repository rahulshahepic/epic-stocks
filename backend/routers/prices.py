from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import User, Price
from schemas import PriceCreate, PriceUpdate, PriceOut
from auth import get_current_user

router = APIRouter(prefix="/api/prices", tags=["prices"])


@router.get("", response_model=list[PriceOut])
def list_prices(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()


@router.post("", response_model=PriceOut, status_code=201)
def create_price(body: PriceCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = Price(**body.model_dump(), user_id=user.id)
    db.add(price)
    db.commit()
    db.refresh(price)
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
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(price, k, v)
    db.commit()
    db.refresh(price)
    return price


@router.delete("/{price_id}", status_code=204)
def delete_price(price_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    price = db.query(Price).filter(Price.id == price_id, Price.user_id == user.id).first()
    if not price:
        raise HTTPException(status_code=404, detail="Price not found")
    db.delete(price)
    db.commit()
