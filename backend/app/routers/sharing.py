"""Invitation & sharing endpoints — invite users by email, accept invites, view shared data."""
import logging
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db
from scaffold.auth import get_current_user
from scaffold.models import (User, Invitation, InvitationOptOut, BlockedEmail,
                             InviteSendEvent, InviteSendingBlock)
from scaffold.invite_tokens import code_verifier, seal_code, token_verifier, unseal_code

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sharing", tags=["sharing"])

INVITE_EXPIRY_DAYS = 7
# Unambiguous charset for short codes (no 0/O/1/I/l)
_CODE_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


# At most this many invitation emails — new invitations and resends alike —
# may leave one account in 24 hours.
INVITE_DAILY_LIMIT = 10
_INVITE_WINDOW = timedelta(hours=24)
# Namespace for the per-user advisory lock; xor'd with the user id.
_INVITE_LOCK_NS = 0x1E5E4D00


def _reserve_invite_send(db: Session, user_id: int) -> None:
    """Consume one of this account's daily invitation emails, or raise 429.

    Counted in its own table rather than over `invitations`, because an
    invitation row is not a record of a send. Sending to an address, revoking,
    and sending again deletes the earlier row — the unique constraint on
    (inviter_id, invitee_email) requires it — and the row that was deleted was
    the one being counted. Eleven emails went out with one row to show for it.

    Call it once every validation has passed and immediately before the send,
    so a refused request spends nothing. Attempts are counted, not deliveries:
    the limit exists to bound what this account can aim at other people's
    inboxes, and an attempt is what does the aiming.
    """
    from sqlalchemy import text
    import database as _database

    if not _database._is_sqlite:
        # Hold the counter for this user against the rest of this transaction,
        # so two concurrent requests cannot both read the same count and both
        # decide there is room. SQLite serializes writers on its own.
        db.execute(
            text("SELECT pg_advisory_xact_lock(:k)"),
            {"k": _INVITE_LOCK_NS ^ user_id},
        )

    now = datetime.now(timezone.utc)

    # Rows well outside the window are never read again. Pruned before the
    # count, not after the insert, so the delete and the add do not land in the
    # same flush.
    db.query(InviteSendEvent).filter(
        InviteSendEvent.user_id == user_id,
        InviteSendEvent.sent_at < now - 2 * _INVITE_WINDOW,
    ).delete(synchronize_session="fetch")

    sent = db.query(InviteSendEvent).filter(
        InviteSendEvent.user_id == user_id,
        InviteSendEvent.sent_at >= now - _INVITE_WINDOW,
    ).count()
    if sent >= INVITE_DAILY_LIMIT:
        raise HTTPException(
            429, f"You can send at most {INVITE_DAILY_LIMIT} invitations per 24 hours"
        )

    db.add(InviteSendEvent(user_id=user_id, sent_at=now))
    db.commit()


def _generate_token() -> str:
    """The raw token. Only its verifier is stored; this value is emailed once."""
    return secrets.token_urlsafe(48)


def _generate_short_code(db: Session) -> str:
    """The raw code. Uniqueness is checked against the stored verifier."""
    for _ in range(20):
        code = "".join(secrets.choice(_CODE_CHARS) for _ in range(8))
        if not db.query(Invitation).filter(
            Invitation.short_code == code_verifier(code)
        ).first():
            return code
    raise RuntimeError("Failed to generate unique short code")


def _normalize_code(code: str) -> str:
    return code.replace("-", "").replace(" ", "").upper()


def _format_short_code(code: str | None) -> str | None:
    """Format 8-char code as XXXX-XXXX for display."""
    if not code:
        return None
    return f"{code[:4]}-{code[4:]}" if len(code) == 8 else code


def _find_by_token(db: Session, raw_token: str) -> Invitation | None:
    return db.query(Invitation).filter(
        Invitation.token == token_verifier(raw_token)
    ).first()


def _find_by_code(db: Session, raw_code: str) -> Invitation | None:
    return db.query(Invitation).filter(
        Invitation.short_code == code_verifier(_normalize_code(raw_code))
    ).first()


# ── Public endpoint (no auth required) ──────────────────────────────────────

@router.get("/invite-info")
def invite_info(
    token: str | None = Query(None),
    code: str | None = Query(None),
    request: Request = None,
    db: Session = Depends(get_db),
):
    """Look up invitation by token or code. Returns inviter name + status. No auth required."""
    from scaffold.rate_limit import check_rate_ip
    from scaffold.client_ip import client_ip as _client_ip
    client_ip = _client_ip(request) if request else "unknown"
    check_rate_ip(client_ip, "sharing_invite_info", max_calls=20, window_secs=900)
    if not token and not code:
        raise HTTPException(400, "Provide token or code")
    inv = _find_by_token(db, token) if token else _find_by_code(db, code)
    if not inv:
        return {"valid": False, "reason": "Invitation not found"}
    if inv.status == "revoked":
        return {"valid": False, "reason": "This invitation has been revoked"}
    if inv.status == "accepted":
        return {"valid": False, "reason": "This invitation has already been accepted"}
    if inv.status == "declined":
        return {"valid": False, "reason": "This invitation was declined"}
    if inv.expires_at and inv.expires_at.replace(tzinfo=None) < datetime.utcnow():
        return {"valid": False, "reason": "This invitation has expired"}
    inviter = db.get(User, inv.inviter_id)
    return {
        "valid": True,
        "inviter_name": inviter.name or inviter.email if inviter else "Unknown",
        "status": inv.status,
    }


# ── Inviter endpoints ───────────────────────────────────────────────────────

class InviteRequest(BaseModel):
    email: EmailStr


@router.post("/invite")
def send_invite(
    body: InviteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    email = body.email.lower().strip()
    if email == user.email.lower():
        raise HTTPException(422, "You cannot invite yourself")

    # Check if the sender is blocked from sending invitations
    if db.query(InviteSendingBlock).filter(InviteSendingBlock.user_id == user.id).first():
        raise HTTPException(403, "Your ability to send invitations has been restricted. Contact an administrator.")

    # Check if email is blocked
    if db.query(BlockedEmail).filter(BlockedEmail.email == email).first():
        raise HTTPException(422, "This email address cannot receive invitations")

    # Check opt-out
    if db.query(InvitationOptOut).filter(InvitationOptOut.email == email).first():
        raise HTTPException(422, "This email address has opted out of invitations")

    # Check for existing active invitation to this email from this user
    existing = db.query(Invitation).filter(
        Invitation.inviter_id == user.id,
        Invitation.invitee_email == email,
        Invitation.status.in_(["pending", "accepted"]),
    ).first()
    if existing:
        if existing.status == "accepted":
            raise HTTPException(409, "This person already has access to your data")
        raise HTTPException(409, "An invitation to this email is already pending")

    # Spend one of today's sends before anything is written: over the limit,
    # this raises and no invitation row is left behind for an email that never
    # went out.
    _reserve_invite_send(db, user.id)

    # If there was a revoked/declined invitation, remove it so the unique constraint allows a new one
    old = db.query(Invitation).filter(
        Invitation.inviter_id == user.id,
        Invitation.invitee_email == email,
    ).first()
    if old:
        db.delete(old)
        db.flush()

    now = datetime.now(timezone.utc)
    raw_token = _generate_token()
    raw_code = _generate_short_code(db)
    inv = Invitation(
        inviter_id=user.id,
        invitee_email=email,
        token=token_verifier(raw_token),
        short_code=code_verifier(raw_code),
        short_code_sealed=seal_code(raw_code),
        status="pending",
        expires_at=now + timedelta(days=INVITE_EXPIRY_DAYS),
        last_sent_at=now,
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)

    email_sent = _send_invitation_email(inv, user, raw_token, raw_code)

    result = _serialize_invitation(inv, db)
    result["email_sent"] = email_sent
    return result


@router.get("/sent")
def list_sent(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invitations = (
        db.query(Invitation)
        .filter(Invitation.inviter_id == user.id)
        .order_by(Invitation.created_at.desc())
        .all()
    )
    return [_serialize_invitation(inv, db) for inv in invitations]


@router.post("/invite/{invitation_id}/resend")
def resend_invite(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    inv = db.query(Invitation).filter(
        Invitation.id == invitation_id,
        Invitation.inviter_id == user.id,
    ).first()
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv.status != "pending":
        raise HTTPException(422, "Can only resend pending invitations")

    # Check if recipient has opted out since the original invite was sent
    if db.query(InvitationOptOut).filter(InvitationOptOut.email == inv.invitee_email).first():
        raise HTTPException(422, "This email address has opted out of invitations")

    # Rate-limit resends: at most once per hour
    now = datetime.now(timezone.utc)
    if inv.last_sent_at:
        last = inv.last_sent_at.replace(tzinfo=timezone.utc) if inv.last_sent_at.tzinfo is None else inv.last_sent_at
        if (now - last).total_seconds() < 3600:
            raise HTTPException(429, "Please wait before resending this invitation")

    # A resend is a send: it comes out of the same daily budget, and it is
    # reserved before the invitation is touched so a refusal changes nothing.
    _reserve_invite_send(db, user.id)

    inv.expires_at = now + timedelta(days=INVITE_EXPIRY_DAYS)
    inv.last_sent_at = now
    db.commit()

    # Only the token's verifier was kept, so the original link cannot be
    # rebuilt. Issue a fresh token instead; the superseded link stops working,
    # which is what re-issuing an invitation should mean. The short code is
    # left alone — the inviter may have already read it out to someone.
    raw_token = _generate_token()
    inv.token = token_verifier(raw_token)
    db.commit()

    raw_code = unseal_code(inv.short_code_sealed)
    email_sent = _send_invitation_email(inv, user, raw_token, raw_code)
    result = _serialize_invitation(inv, db)
    result["email_sent"] = email_sent
    return result


@router.delete("/invite/{invitation_id}", status_code=204)
def revoke_invite(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    inv = db.query(Invitation).filter(
        Invitation.id == invitation_id,
        Invitation.inviter_id == user.id,
    ).first()
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv.status in ("pending", "accepted"):
        inv.status = "revoked"
        db.commit()


# ── Invitee endpoints ───────────────────────────────────────────────────────

class AcceptRequest(BaseModel):
    token: str | None = None
    code: str | None = None


@router.post("/accept")
def accept_invite(
    body: AcceptRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from scaffold.rate_limit import check_rate_ip
    from scaffold.client_ip import client_ip as _client_ip
    client_ip = _client_ip(request)
    check_rate_ip(client_ip, "sharing_accept", max_calls=20, window_secs=900)
    if not body.token and not body.code:
        raise HTTPException(400, "Provide token or code")

    inv = _find_by_token(db, body.token) if body.token else _find_by_code(db, body.code)

    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv.status == "revoked":
        raise HTTPException(410, "This invitation has been revoked")
    if inv.status == "declined":
        raise HTTPException(410, "This invitation was declined")
    if inv.status == "accepted":
        if inv.invitee_id == user.id:
            return {"message": "You already accepted this invitation", "invitation_id": inv.id}
        raise HTTPException(410, "This invitation has already been used by someone else")
    if inv.expires_at and inv.expires_at.replace(tzinfo=None) < datetime.utcnow():
        raise HTTPException(410, "This invitation has expired")
    if inv.inviter_id == user.id:
        raise HTTPException(422, "You cannot accept your own invitation")

    # Check if this user already has access from this inviter via another invitation
    existing_access = db.query(Invitation).filter(
        Invitation.inviter_id == inv.inviter_id,
        Invitation.invitee_id == user.id,
        Invitation.status == "accepted",
    ).first()
    if existing_access:
        raise HTTPException(409, "You already have access to this person's data")

    inv.status = "accepted"
    inv.invitee_id = user.id
    inv.invitee_account_email = user.email
    inv.accepted_at = datetime.now(timezone.utc)
    db.commit()

    # Notify the inviter
    _notify_inviter_accepted(inv, db)

    inviter = db.get(User, inv.inviter_id)
    return {
        "message": "Invitation accepted",
        "invitation_id": inv.id,
        "inviter_name": inviter.name or inviter.email if inviter else "Unknown",
    }


@router.get("/received")
def list_received(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invitations = (
        db.query(Invitation)
        .filter(Invitation.invitee_id == user.id, Invitation.status == "accepted")
        .order_by(Invitation.accepted_at.desc())
        .all()
    )
    result = []
    for inv in invitations:
        inviter = db.get(User, inv.inviter_id)
        result.append({
            "id": inv.id,
            "inviter_name": inviter.name if inviter else None,
            "inviter_email": inviter.email if inviter else None,
            "accepted_at": inv.accepted_at.isoformat() if inv.accepted_at else None,
            "last_viewed_at": inv.last_viewed_at.isoformat() if inv.last_viewed_at else None,
            "notify_enabled": bool(inv.notify_enabled),
        })
    return result


@router.post("/decline/{invitation_id}", status_code=204)
def decline_invite(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    inv = db.query(Invitation).filter(Invitation.id == invitation_id).first()
    if not inv:
        raise HTTPException(404, "Invitation not found")
    # Invitee can decline a pending invite (matched by email) or remove accepted access
    if inv.invitee_id == user.id and inv.status == "accepted":
        inv.status = "declined"
        db.commit()
        return
    # Allow declining by email match for pending invites
    if inv.invitee_email == user.email.lower() and inv.status == "pending":
        inv.status = "declined"
        inv.invitee_id = user.id
        inv.invitee_account_email = user.email
        db.commit()
        return
    raise HTTPException(404, "Invitation not found")


@router.delete("/access/{invitation_id}", status_code=204)
def remove_access(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invitee removes their own access to an inviter's data."""
    inv = db.query(Invitation).filter(
        Invitation.id == invitation_id,
        Invitation.invitee_id == user.id,
        Invitation.status == "accepted",
    ).first()
    if not inv:
        raise HTTPException(404, "Access not found")
    inv.status = "declined"
    db.commit()


class NotifyToggle(BaseModel):
    enabled: bool


@router.put("/access/{invitation_id}/notify")
def toggle_notify(
    invitation_id: int,
    body: NotifyToggle,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    inv = db.query(Invitation).filter(
        Invitation.id == invitation_id,
        Invitation.invitee_id == user.id,
        Invitation.status == "accepted",
    ).first()
    if not inv:
        raise HTTPException(404, "Access not found")
    inv.notify_enabled = int(body.enabled)
    db.commit()
    return {"enabled": bool(inv.notify_enabled)}


# ── Shared data view endpoints ──────────────────────────────────────────────

def _get_shared_owner(invitation_id: int, viewer: User, db: Session) -> User:
    """Verify viewer has accepted access, set owner's encryption key, update last_viewed_at."""
    inv = db.query(Invitation).filter(
        Invitation.id == invitation_id,
        Invitation.invitee_id == viewer.id,
        Invitation.status == "accepted",
    ).first()
    if not inv:
        raise HTTPException(404, "Shared access not found")

    # Fetch the owner's encrypted_key via raw SQL so no TypeDecorator decryption
    # runs with the viewer's key before we've switched to the owner's key.
    from sqlalchemy import text as _text
    key_row = db.execute(
        _text("SELECT id, encrypted_key FROM users WHERE id = :uid"),
        {"uid": inv.inviter_id},
    ).fetchone()
    if not key_row:
        raise HTTPException(404, "User not found")

    # Switch encryption context to the data owner BEFORE the ORM loads
    # any encrypted columns on the owner's User row.
    from scaffold.crypto import encryption_enabled, decrypt_user_key, set_current_key
    if encryption_enabled() and key_row.encrypted_key:
        set_current_key(decrypt_user_key(key_row.encrypted_key))
    else:
        set_current_key(None)

    owner = db.get(User, key_row.id)
    if not owner:
        raise HTTPException(404, "User not found")

    inv.last_viewed_at = datetime.now(timezone.utc)
    db.commit()
    return owner


@router.get("/view/{invitation_id}/dashboard")
def shared_dashboard(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from app.routers.events import _get_dashboard_data
    return _get_dashboard_data(owner, db)


@router.get("/view/{invitation_id}/events")
def shared_events(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from app.routers.events import _get_events_data
    return _get_events_data(owner, db)


@router.get("/view/{invitation_id}/grants")
def shared_grants(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from scaffold.models import Grant
    return db.query(Grant).filter(Grant.user_id == owner.id).order_by(Grant.year).all()


@router.get("/view/{invitation_id}/loans")
def shared_loans(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from scaffold.models import Loan
    return db.query(Loan).filter(Loan.user_id == owner.id).order_by(Loan.due_date).all()


@router.get("/view/{invitation_id}/prices")
def shared_prices(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from scaffold.models import Price
    return db.query(Price).filter(Price.user_id == owner.id).order_by(Price.effective_date).all()


@router.get("/view/{invitation_id}/sales")
def shared_sales(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from scaffold.models import Sale
    return db.query(Sale).filter(Sale.user_id == owner.id).order_by(Sale.date).all()


@router.get("/view/{invitation_id}/preview-exit")
def shared_preview_exit(
    invitation_id: int,
    date: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from app.routers.events import _preview_exit_data
    return _preview_exit_data(owner, db, date)


@router.get("/view/{invitation_id}/profile")
def shared_profile(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the data owner's profile fields the viewer needs (DOB drives age math)."""
    owner = _get_shared_owner(invitation_id, user, db)
    return {
        "name": owner.name,
        "date_of_birth": owner.date_of_birth.isoformat() if owner.date_of_birth else None,
    }


@router.get("/view/{invitation_id}/retirement-params")
def shared_retirement_params(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read-only: viewer sees the owner's saved simulator params."""
    owner = _get_shared_owner(invitation_id, user, db)
    return {"params": owner.retirement_params}


@router.get("/view/{invitation_id}/comp-entries")
def shared_comp_entries(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read-only: viewer sees the owner's saved salary/bonus entries."""
    owner = _get_shared_owner(invitation_id, user, db)
    return {"entries": owner.comp_entries or []}


@router.get("/view/{invitation_id}/dashboard-prefs")
def shared_dashboard_prefs(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Read-only: viewer sees the owner's saved dashboard view state."""
    owner = _get_shared_owner(invitation_id, user, db)
    return {"prefs": owner.dashboard_prefs or {}}


@router.get("/view/{invitation_id}/tax-settings")
def shared_tax_settings(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from app.routers.sales import _get_or_create_tax_settings, _flexible_payoff_enabled
    from schemas import TaxSettingsRead
    from scaffold.models import Grant
    ts = _get_or_create_tax_settings(owner, db)
    result = TaxSettingsRead.model_validate(ts)
    result.flexible_payoff_enabled = _flexible_payoff_enabled(db)
    grants = db.query(Grant).filter(Grant.user_id == owner.id).all()
    years: set[int] = set()
    for g in grants:
        if g.vest_start and g.periods:
            for i in range(g.periods):
                years.add(g.vest_start.year + i)
    result.taxable_years = sorted(years)
    return result


@router.get("/view/{invitation_id}/sales/{sale_id}/tax")
def shared_sale_tax(
    invitation_id: int,
    sale_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner = _get_shared_owner(invitation_id, user, db)
    from scaffold.models import Sale, TaxSettings
    from app.routers.events import _user_source_data
    from services.timeline_cache import get_timeline
    from app.sales_engine import compute_sale_tax

    sale = db.query(Sale).filter(Sale.id == sale_id, Sale.user_id == owner.id).first()
    if not sale:
        raise HTTPException(404, "Sale not found")

    ts_row = db.query(TaxSettings).filter(TaxSettings.user_id == owner.id).first()
    if not ts_row:
        raise HTTPException(404, "Tax settings not found")

    grants, prices, loans, _loans_db, initial_price, _e83b, _ = _user_source_data(owner, db)
    if not grants or not prices:
        raise HTTPException(422, "Insufficient data")

    timeline = get_timeline(owner.id, grants, prices, loans, initial_price)
    ts_dict = {
        "federal_income_rate": sale.federal_income_rate if sale.federal_income_rate is not None else ts_row.federal_income_rate,
        "federal_lt_cg_rate": sale.federal_lt_cg_rate if sale.federal_lt_cg_rate is not None else ts_row.federal_lt_cg_rate,
        "federal_st_cg_rate": sale.federal_st_cg_rate if sale.federal_st_cg_rate is not None else ts_row.federal_st_cg_rate,
        "niit_rate": sale.niit_rate if sale.niit_rate is not None else ts_row.niit_rate,
        "state_income_rate": sale.state_income_rate if sale.state_income_rate is not None else ts_row.state_income_rate,
        "state_lt_cg_rate": sale.state_lt_cg_rate if sale.state_lt_cg_rate is not None else ts_row.state_lt_cg_rate,
        "state_st_cg_rate": sale.state_st_cg_rate if sale.state_st_cg_rate is not None else ts_row.state_st_cg_rate,
        "lt_holding_days": sale.lt_holding_days if sale.lt_holding_days is not None else ts_row.lt_holding_days,
    }
    return compute_sale_tax(timeline, {"date": sale.date, "shares": sale.shares, "price_per_share": sale.price_per_share}, ts_dict)


@router.get("/view/{invitation_id}/export/excel")
def shared_export_excel(
    invitation_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Re-use the standard export endpoint logic with the owner user.

    We import the endpoint handler function and call it directly, passing the
    owner user instead of get_current_user.  FastAPI endpoint handlers are plain
    functions — calling them with explicit args bypasses the DI system.
    """
    owner = _get_shared_owner(invitation_id, user, db)
    from app.routers.import_export import export_excel
    return export_excel(user=owner, db=db)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _serialize_invitation(inv: Invitation, db: Session) -> dict:
    invitee = db.get(User, inv.invitee_id) if inv.invitee_id else None
    return {
        "id": inv.id,
        "invitee_email": inv.invitee_email,
        "status": inv.status,
        "short_code": _format_short_code(unseal_code(inv.short_code_sealed)),
        "created_at": inv.created_at.isoformat() if inv.created_at else None,
        "expires_at": inv.expires_at.isoformat() if inv.expires_at else None,
        "accepted_at": inv.accepted_at.isoformat() if inv.accepted_at else None,
        "last_viewed_at": inv.last_viewed_at.isoformat() if inv.last_viewed_at else None,
        "invitee_account_email": inv.invitee_account_email,
        "invitee_name": invitee.name if invitee else None,
    }


def _send_invitation_email(inv: Invitation, inviter: User, raw_token: str, raw_code: str | None) -> bool:
    """Send the invitation email (best-effort). Returns True if sent.

    The raw secrets are passed in rather than read off `inv`, which holds only
    their verifiers — this is the one place they are used, and they are not
    kept afterwards.
    """
    try:
        from scaffold.email_sender import send_email, email_configured, build_invitation_email
        if not email_configured():
            logger.info("Email not configured, skipping invitation email")
            return False
        subject, text, html, hdrs = build_invitation_email(
            inviter_name=inviter.name or inviter.email,
            token=raw_token,
            short_code=_format_short_code(raw_code),
            recipient_email=inv.invitee_email,
        )
        return send_email(inv.invitee_email, subject, text, html, headers=hdrs)
    except Exception:
        logger.exception("Failed to send invitation email to %s", inv.invitee_email)
        return False


def _notify_inviter_accepted(inv: Invitation, db: Session):
    """Notify the inviter that their invitation was accepted (best-effort)."""
    try:
        inviter = db.get(User, inv.inviter_id)
        if not inviter:
            return
        invitee = db.get(User, inv.invitee_id) if inv.invitee_id else None
        who = invitee.name or invitee.email if invitee else (inv.invitee_account_email or inv.invitee_email)
        subject = f"Epic Stocks: {who} accepted your invitation"
        text = f"{who} has accepted your invitation to view your equity data."
        from html import escape as _esc
        html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Epic Stocks</h2>
  <p><strong>{_esc(who)}</strong> has accepted your invitation to view your equity data.</p>
</div>"""

        from scaffold.email_sender import send_email, email_configured
        if email_configured():
            send_email(inviter.email, subject, text, html)

        # Push notification with deep link to settings (sharing section)
        from scaffold.models import PushSubscription
        from scaffold.notifications import send_push
        subs = db.query(PushSubscription).filter(PushSubscription.user_id == inviter.id).all()
        payload = {
            "title": "Invitation Accepted",
            "body": f"{who} accepted your invitation",
            "data": {"url": "/settings"},
        }
        for sub in subs:
            ok = send_push(sub, payload)
            if not ok:
                db.delete(sub)
        db.commit()
    except Exception:
        logger.exception("Failed to notify inviter about acceptance")


def _notify_inviter_status(inviter: User, inv: Invitation, action: str):
    """Placeholder for future notifications about invitation status changes."""
    pass
