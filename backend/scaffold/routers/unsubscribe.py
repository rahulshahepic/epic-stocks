"""Public (no-auth) unsubscribe endpoints for CAN-SPAM compliance."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/unsubscribe", tags=["unsubscribe"])


class UnsubscribeRequest(BaseModel):
    token: str
    email: str
    type: str  # 'invite' or 'notify'


class UnsubscribeStatus(BaseModel):
    valid: bool
    email: str
    type: str
    already_unsubscribed: bool = False


@router.get("", response_model=UnsubscribeStatus)
def check_unsubscribe(token: str, email: str, type: str, db: Session = Depends(get_db)):
    """Verify an unsubscribe token. No auth required."""
    from scaffold.email_sender import verify_unsubscribe_token

    email = email.lower().strip()
    if type not in ("invite", "notify"):
        return UnsubscribeStatus(valid=False, email=email, type=type)

    if not verify_unsubscribe_token(token, email, type):
        return UnsubscribeStatus(valid=False, email=email, type=type)

    already = _is_already_unsubscribed(email, type, db)
    return UnsubscribeStatus(valid=True, email=email, type=type, already_unsubscribed=already)


@router.post("")
def process_unsubscribe(body: UnsubscribeRequest, db: Session = Depends(get_db)):
    """Process an unsubscribe request. No auth required."""
    from scaffold.email_sender import verify_unsubscribe_token

    email = body.email.lower().strip()
    if body.type not in ("invite", "notify"):
        raise HTTPException(400, "Invalid unsubscribe type")

    if not verify_unsubscribe_token(body.token, email, body.type):
        raise HTTPException(403, "Invalid or expired unsubscribe link")

    if body.type == "invite":
        _unsubscribe_invitations(email, db)
    elif body.type == "notify":
        _unsubscribe_notifications(email, db)

    return {"success": True, "email": email, "type": body.type}


def _is_already_unsubscribed(email: str, category: str, db: Session) -> bool:
    if category == "invite":
        from scaffold.models import InvitationOptOut
        return db.query(InvitationOptOut).filter(InvitationOptOut.email == email).first() is not None
    elif category == "notify":
        from scaffold.models import User, EmailPreference
        user = db.query(User).filter(User.email == email).first()
        if not user:
            return False
        pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
        return pref is not None and pref.enabled == 0
    return False


def _unsubscribe_invitations(email: str, db: Session):
    """Add email to invitation opt-out list and decline all pending invites."""
    from scaffold.models import InvitationOptOut, Invitation
    existing = db.query(InvitationOptOut).filter(InvitationOptOut.email == email).first()
    if not existing:
        db.add(InvitationOptOut(email=email))
    # Decline all pending invitations addressed to this email
    db.query(Invitation).filter(
        Invitation.invitee_email == email,
        Invitation.status == "pending",
    ).update({"status": "declined"})
    db.commit()


def _unsubscribe_notifications(email: str, db: Session):
    """Disable email notifications for this user."""
    from scaffold.models import User, EmailPreference
    user = db.query(User).filter(User.email == email).first()
    if not user:
        # User doesn't have an account — nothing to disable, but don't reveal that
        return
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if pref:
        pref.enabled = 0
    else:
        db.add(EmailPreference(user_id=user.id, enabled=0))
    db.commit()
