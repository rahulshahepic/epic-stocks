"""Email notification preference endpoints."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, EmailPreference
from auth import get_current_user

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


@router.get("/email")
def get_email_pref(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    return {
        "enabled": bool(pref.enabled) if pref else False,
        "advance_days": (pref.advance_days or 0) if pref else 0,
    }


@router.put("/email")
def set_email_pref(enabled: bool, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if pref:
        pref.enabled = int(enabled)
    else:
        pref = EmailPreference(user_id=user.id, enabled=int(enabled))
        db.add(pref)
    db.commit()
    return {
        "enabled": bool(pref.enabled),
        "advance_days": pref.advance_days or 0,
    }


@router.put("/advance-days")
def set_advance_days(advance_days: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Set how many days in advance to send notifications (0 = day-of, 7 = one week before)."""
    advance_days = max(0, min(advance_days, 30))
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if pref:
        pref.advance_days = advance_days
    else:
        pref = EmailPreference(user_id=user.id, enabled=0, advance_days=advance_days)
        db.add(pref)
    db.commit()
    return {
        "enabled": bool(pref.enabled),
        "advance_days": pref.advance_days or 0,
    }
