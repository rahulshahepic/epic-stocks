import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, BlockedEmail
from scaffold.auth import create_token, get_admin_emails, set_session_cookies, clear_session_cookies
from scaffold.crypto import encryption_enabled, generate_user_key, encrypt_user_key
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _notify_admin_new_user(user: User, db: Session):
    """Send admin email + check milestone (best-effort, never blocks login)."""
    try:
        from scaffold.notifications import send_admin_new_user_notification, check_user_milestone
        send_admin_new_user_notification(user)
        check_user_milestone(db)
    except Exception:
        logger.exception("Failed to send admin notification for new user")


def _upsert_user(identity, db: Session) -> User:
    """Create or update a User from a provider UserIdentity. Returns the user."""
    email = identity.email
    check_email = email.lower()

    blocked = db.query(BlockedEmail).filter(BlockedEmail.email == check_email).first()
    if blocked:
        raise HTTPException(status_code=403, detail="Account blocked")

    user = db.query(User).filter(User.google_id == identity.provider_sub).first()
    if not user:
        enc_key = encrypt_user_key(generate_user_key()) if encryption_enabled() else None
        user = User(
            email=email,
            google_id=identity.provider_sub,
            name=identity.name,
            picture=identity.picture,
            encrypted_key=enc_key,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        _notify_admin_new_user(user, db)
    else:
        user.email = email
        user.name = identity.name
        user.picture = identity.picture
        db.commit()

    user.is_admin = int(user.email.lower() in get_admin_emails())
    user.last_login = datetime.now(timezone.utc)
    db.commit()
    return user


# ── OIDC provider list ──────────────────────────────────────────────────────────

@router.get("/providers")
def list_providers():
    """Return the list of configured OIDC providers for the login page."""
    from scaffold.providers.auth import get_providers
    return [{"name": p.config.name, "label": p.config.label} for p in get_providers()]


# ── PKCE flow ───────────────────────────────────────────────────────────────────

@router.get("/login")
def login_start(provider: str, code_challenge: str, redirect_uri: str, state: str):
    """Return the IdP authorization URL for the given provider."""
    from scaffold.providers.auth import get_provider
    try:
        p = get_provider(provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"authorization_url": p.get_authorization_url(state, code_challenge, redirect_uri)}


class CallbackRequest(BaseModel):
    provider: str
    code: str
    code_verifier: str
    redirect_uri: str


@router.post("/callback")
def auth_callback(body: CallbackRequest, response: Response, db: Session = Depends(get_db)):
    """Exchange PKCE authorization code for a JWT; set it as an HttpOnly session cookie."""
    from scaffold.providers.auth import get_provider
    from scaffold.providers.auth.base import UserIdentity
    try:
        p = get_provider(body.provider)
        identity: UserIdentity = p.exchange_code(body.code, body.code_verifier, body.redirect_uri)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    user = _upsert_user(identity, db)
    token = create_token(user.id)
    set_session_cookies(response, token)
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    """Clear the session cookie."""
    clear_session_cookies(response)
    return {"ok": True}


# E2E/test-only endpoint: creates or updates a user without going through any IdP.
# Respects all real login logic (blocked email check, admin flag, last_login).
if os.getenv("E2E_TEST") == "1":
    class TestLoginRequest(BaseModel):
        email: str
        name: str = "Test User"

    @router.post("/test-login")
    def test_login(body: TestLoginRequest, response: Response, db: Session = Depends(get_db)):
        """Create/update a user and set the session cookie. No Bearer token returned."""
        from scaffold.providers.auth.base import UserIdentity
        identity = UserIdentity(
            provider_sub=f"test-{body.email}",
            email=body.email,
            email_verified=True,
            name=body.name,
            picture=None,
        )
        user = _upsert_user(identity, db)
        set_session_cookies(response, create_token(user.id))
        return {"ok": True}
