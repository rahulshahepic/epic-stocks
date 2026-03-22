from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
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
    existing = db.query(Grant).filter(
        Grant.user_id == user.id, Grant.year == body.year, Grant.type == body.type
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"A {body.type} grant for {body.year} already exists")
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
