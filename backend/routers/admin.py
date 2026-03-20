import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from database import get_db
from models import User, Grant, Loan, Price, PushSubscription, BlockedEmail
from auth import get_admin_user, get_admin_emails

router = APIRouter(prefix="/api/admin", tags=["admin"])


class AdminStats(BaseModel):
    total_users: int
    active_users_30d: int
    total_grants: int
    total_loans: int
    total_prices: int
    db_size_bytes: int


class UserSummary(BaseModel):
    id: int
    email: str
    name: str | None
    is_admin: bool
    created_at: str
    last_login: str | None
    grant_count: int
    loan_count: int
    price_count: int


class BlockEmailRequest(BaseModel):
    email: str
    reason: str = ""


class BlockedEmailOut(BaseModel):
    id: int
    email: str
    reason: str | None
    blocked_at: str


@router.get("/stats", response_model=AdminStats)
def admin_stats(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    total_users = db.query(func.count(User.id)).scalar()
    active_users = db.query(func.count(User.id)).filter(User.last_login >= cutoff).scalar()
    total_grants = db.query(func.count(Grant.id)).scalar()
    total_loans = db.query(func.count(Loan.id)).scalar()
    total_prices = db.query(func.count(Price.id)).scalar()

    db_path = os.path.join(os.path.dirname(__file__), "..", "data", "vesting.db")
    try:
        db_size = os.path.getsize(db_path)
    except OSError:
        db_size = 0

    return AdminStats(
        total_users=total_users,
        active_users_30d=active_users,
        total_grants=total_grants,
        total_loans=total_loans,
        total_prices=total_prices,
        db_size_bytes=db_size,
    )


class UserListResponse(BaseModel):
    users: list[UserSummary]
    total: int


@router.get("/users", response_model=UserListResponse)
def admin_users(
    q: str = "",
    limit: int = 10,
    offset: int = 0,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    admin_emails = get_admin_emails()
    query = db.query(User)
    if q:
        query = query.filter(User.email.ilike(f"%{q}%") | User.name.ilike(f"%{q}%"))
    total = query.count()
    # Sort by last_login descending, nulls last
    users = query.order_by(User.last_login.desc().nullslast()).offset(offset).limit(limit).all()
    result = []
    for u in users:
        gc = db.query(func.count(Grant.id)).filter(Grant.user_id == u.id).scalar()
        lc = db.query(func.count(Loan.id)).filter(Loan.user_id == u.id).scalar()
        pc = db.query(func.count(Price.id)).filter(Price.user_id == u.id).scalar()
        result.append(UserSummary(
            id=u.id, email=u.email, name=u.name,
            is_admin=u.email.lower() in admin_emails,
            created_at=u.created_at.isoformat() if u.created_at else "",
            last_login=u.last_login.isoformat() if u.last_login else None,
            grant_count=gc, loan_count=lc, price_count=pc,
        ))
    return UserListResponse(users=result, total=total)


@router.delete("/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email.lower() in get_admin_emails():
        raise HTTPException(status_code=400, detail="Cannot delete an admin user")
    # Delete related records first to avoid loading encrypted columns with wrong key
    db.query(Grant).filter(Grant.user_id == user_id).delete()
    db.query(Loan).filter(Loan.user_id == user_id).delete()
    db.query(Price).filter(Price.user_id == user_id).delete()
    db.query(PushSubscription).filter(PushSubscription.user_id == user_id).delete()
    db.query(User).filter(User.id == user_id).delete()
    db.commit()


@router.get("/blocked", response_model=list[BlockedEmailOut])
def list_blocked(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    entries = db.query(BlockedEmail).order_by(BlockedEmail.blocked_at.desc()).all()
    return [BlockedEmailOut(
        id=e.id, email=e.email, reason=e.reason,
        blocked_at=e.blocked_at.isoformat() if e.blocked_at else "",
    ) for e in entries]


@router.post("/blocked", response_model=BlockedEmailOut, status_code=201)
def block_email(body: BlockEmailRequest, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    existing = db.query(BlockedEmail).filter(BlockedEmail.email == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already blocked")
    entry = BlockedEmail(email=email, reason=body.reason)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return BlockedEmailOut(
        id=entry.id, email=entry.email, reason=entry.reason,
        blocked_at=entry.blocked_at.isoformat() if entry.blocked_at else "",
    )


@router.delete("/blocked/{block_id}", status_code=204)
def unblock_email(block_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    entry = db.get(BlockedEmail, block_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Blocked entry not found")
    db.delete(entry)
    db.commit()
