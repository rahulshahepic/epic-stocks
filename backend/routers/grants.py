from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import User, Grant
from schemas import GrantCreate, GrantUpdate, GrantOut
from auth import get_current_user

router = APIRouter(prefix="/api/grants", tags=["grants"])


@router.get("", response_model=list[GrantOut])
def list_grants(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all()


@router.post("", response_model=GrantOut, status_code=201)
def create_grant(body: GrantCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(grant, k, v)
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
