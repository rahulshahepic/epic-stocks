"""Public (no-auth) unsubscribe endpoints for CAN-SPAM compliance."""
import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.auth import get_current_user
from scaffold.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/unsubscribe", tags=["unsubscribe"])


def _limit(request: Request, endpoint: str, max_calls: int, window_secs: int = 900) -> None:
    """Cap how fast one caller can probe these routes.

    These routes take an HMAC token off the URL and are reachable with no
    session, so without a limit they are free to hammer: a token oracle on one
    side, and a supply of cheap requests that each touch the database on the
    other.

    The token is a SHA-256 HMAC, so guessing it is infeasible at any rate this
    would permit; the budget only has to stop a flood, and it is shared by
    everyone leaving one office network through one address.
    """
    from scaffold.client_ip import client_ip as _client_ip
    from scaffold.rate_limit import check_rate_ip_shared
    check_rate_ip_shared(_client_ip(request), endpoint,
                         max_calls=max_calls, window_secs=window_secs)


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
def check_unsubscribe(token: str, email: str, type: str, request: Request,
                      db: Session = Depends(get_db)):
    """Verify an unsubscribe token. No auth required."""
    from scaffold.email_sender import verify_unsubscribe_token

    _limit(request, "unsubscribe_check", max_calls=120)
    email = email.lower().strip()
    if type not in ("invite", "notify"):
        return UnsubscribeStatus(valid=False, email=email, type=type)

    if not verify_unsubscribe_token(token, email, type):
        return UnsubscribeStatus(valid=False, email=email, type=type)

    already = _is_already_unsubscribed(email, type, db)
    return UnsubscribeStatus(valid=True, email=email, type=type, already_unsubscribed=already)


@router.post("")
def process_unsubscribe(body: UnsubscribeRequest, request: Request,
                        db: Session = Depends(get_db)):
    """Process an unsubscribe request. No auth required."""
    from scaffold.email_sender import verify_unsubscribe_token

    _limit(request, "unsubscribe_post", max_calls=120)
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


@router.post("/one-click")
def one_click_unsubscribe(token: str, email: str, type: str, request: Request,
                          db: Session = Depends(get_db)):
    """RFC 8058 one-click unsubscribe: the URI in the List-Unsubscribe header.

    Gmail and Outlook show their own "Unsubscribe" button beside the sender and
    POST here when it is pressed — no page, no person, no second confirmation.
    Everything that identifies the request is in the query string, because the
    body RFC 8058 specifies is the fixed string "List-Unsubscribe=One-Click"
    and carries nothing. It is not read at all: a client that sends a different
    body, or none, still meant to unsubscribe, and refusing on that basis would
    fail exactly the way this endpoint exists to stop failing.

    The HMAC in the query string is the whole authorization. There is no session
    here and no CSRF question to answer — the request is meant to arrive from
    another origin entirely, and being able to unsubscribe someone requires
    already knowing a token only they were sent.
    """
    from scaffold.email_sender import verify_unsubscribe_token

    _limit(request, "unsubscribe_one_click", max_calls=120)
    email = email.lower().strip()
    if type not in ("invite", "notify"):
        raise HTTPException(400, "Invalid unsubscribe type")

    if not verify_unsubscribe_token(token, email, type):
        raise HTTPException(403, "Invalid or expired unsubscribe link")

    if type == "invite":
        _unsubscribe_invitations(email, db)
    else:
        _unsubscribe_notifications(email, db)

    # Nothing renders this; the client shows its own confirmation.
    return PlainTextResponse("Unsubscribed.")


@router.get("/one-click")
def one_click_unsubscribe_page(token: str, email: str, type: str, request: Request):
    """Send a person who clicked the header URI to the page with the button.

    Deliberately does not unsubscribe. A GET here is either someone clicking a
    link a mail client rendered from the header, or a security scanner opening
    every URL in the message before it is delivered — and the scanner must not
    be able to unsubscribe the recipient it is protecting. That is the reason
    RFC 8058 specifies a POST at all.

    It also does not mint anything. Building the destination with a fresh
    token would make this an oracle: ask for any address, get back a working
    unsubscribe link for it. The three values are carried across exactly as
    they arrived — re-encoded, so nothing from the query string can shape the
    Location header — and the page itself decides whether the token is good.
    """
    from scaffold.email_sender import app_url

    _limit(request, "unsubscribe_one_click_page", max_calls=600)
    base = app_url()
    if not base:
        raise HTTPException(404, "Not found")
    # An unbounded query string here is an unbounded response header. Past
    # anything a real link could carry — the token is 64 hex, an address is
    # 320 at the outside — send them to the bare page, which says the link is
    # invalid.
    if len(token) > 200 or len(email) > 320 or len(type) > 20:
        return RedirectResponse(f"{base}/unsubscribe", status_code=302)
    query = urlencode({"token": token, "email": email, "type": type})
    return RedirectResponse(f"{base}/unsubscribe?{query}", status_code=302)


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


@router.post("/self")
def unsubscribe_self(
    type: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Authenticated fallback: unsubscribe the current user without a token.

    Used when the HMAC link in an email has expired (e.g. after secret rotation).
    The user must be logged in; their session replaces the token as proof of identity.
    """
    if type not in ("invite", "notify"):
        raise HTTPException(400, "Invalid unsubscribe type")
    if type == "invite":
        _unsubscribe_invitations(user.email.lower(), db)
    else:
        _unsubscribe_notifications(user.email.lower(), db)
    return {"success": True, "email": user.email, "type": type}
