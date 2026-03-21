import logging
import os
from fastapi import APIRouter, Depends, HTTPException

logger = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from database import get_db
from models import User, Grant, Loan, Price, PushSubscription, BlockedEmail, ErrorLog, EmailPreference
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


class ErrorLogOut(BaseModel):
    id: int
    timestamp: str
    method: str | None
    path: str | None
    error_type: str | None
    error_message: str | None
    traceback: str | None
    user_id: int | None


@router.get("/errors", response_model=list[ErrorLogOut])
def admin_errors(
    limit: int = 50,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    entries = db.query(ErrorLog).order_by(ErrorLog.timestamp.desc()).limit(limit).all()
    return [ErrorLogOut(
        id=e.id,
        timestamp=e.timestamp.isoformat() if e.timestamp else "",
        method=e.method,
        path=e.path,
        error_type=e.error_type,
        error_message=e.error_message,
        traceback=e.traceback,
        user_id=e.user_id,
    ) for e in entries]


@router.delete("/errors", status_code=204)
def clear_errors(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    db.query(ErrorLog).delete()
    db.commit()


class TestNotifyRequest(BaseModel):
    user_id: int
    title: str
    body: str


class TestNotifyResult(BaseModel):
    push_sent: int
    push_failed: int
    email_sent: bool
    email_skipped_reason: str | None = None


@router.post("/test-notify", response_model=TestNotifyResult)
def admin_test_notify(
    body: TestNotifyRequest,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == body.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from notifications import send_push
    payload = {"title": body.title, "body": body.body}
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
    push_sent = push_failed = 0
    for sub in subs:
        ok = send_push(sub, payload)
        if ok:
            push_sent += 1
        else:
            push_failed += 1
            db.delete(sub)
    if push_failed:
        db.commit()

    email_sent = False
    email_skipped_reason = None
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if not pref or not pref.enabled:
        email_skipped_reason = "user has email notifications disabled"
    else:
        from email_sender import send_email, email_configured
        if not email_configured():
            email_skipped_reason = "RESEND_API_KEY not configured"
        else:
            try:
                email_sent = send_email(
                    user.email,
                    body.title,
                    body.body,
                    f"<p>{body.body}</p>",
                )
                if not email_sent:
                    email_skipped_reason = "send failed (check server logs)"
            except Exception:
                import traceback as tb
                logger.exception("Error sending test email to %s", user.email)
                db.add(ErrorLog(
                    method="POST",
                    path="/api/admin/test-notify",
                    error_type="EmailSendError",
                    error_message=f"Failed to send test email to {user.email}",
                    traceback=tb.format_exc(),
                    user_id=admin.id,
                ))
                db.commit()
                email_skipped_reason = "send failed (check server logs)"

    return TestNotifyResult(push_sent=push_sent, push_failed=push_failed, email_sent=email_sent, email_skipped_reason=email_skipped_reason)
