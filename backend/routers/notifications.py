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
    return {"enabled": bool(pref.enabled) if pref else False}


@router.put("/email")
def set_email_pref(enabled: bool, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if pref:
        pref.enabled = enabled
    else:
        pref = EmailPreference(user_id=user.id, enabled=enabled)
        db.add(pref)
    db.commit()
    return {"enabled": bool(pref.enabled)}
