import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, BlockedEmail
from schemas import AuthResponse
from scaffold.auth import create_token, get_admin_emails
from scaffold.crypto import encryption_enabled, generate_user_key, encrypt_user_key
# verify_google_token imported here so conftest.py can patch it at this module path
from scaffold.providers.auth.google import verify_google_token
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


def _upsert_user(identity, db: Session, blocked_check_email: str | None = None) -> User:
    """Create or update a User from a provider UserIdentity. Returns the user."""
    email = identity.email
    check_email = (blocked_check_email or email).lower()

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


# ── PKCE flow ──────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    code_challenge: str
    redirect_uri: str
    state: str


class CallbackRequest(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str


@router.get("/login")
def login_start(code_challenge: str, redirect_uri: str, state: str):
    """Return the IdP authorization URL. Frontend redirects the user there."""
    from scaffold.providers.auth import get_auth_provider
    provider = get_auth_provider()
    url = provider.get_authorization_url(state, code_challenge, redirect_uri)
    return {"authorization_url": url}


@router.post("/callback", response_model=AuthResponse)
def auth_callback(body: CallbackRequest, db: Session = Depends(get_db)):
    """Exchange PKCE authorization code for a JWT access token."""
    from scaffold.providers.auth import get_auth_provider
    from scaffold.providers.auth.base import UserIdentity
    provider = get_auth_provider()
    try:
        identity: UserIdentity = provider.exchange_code(body.code, body.code_verifier, body.redirect_uri)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))
    user = _upsert_user(identity, db)
    return AuthResponse(access_token=create_token(user.id))


# ── Legacy Google GSI flow (kept for backward compat / E2E test infrastructure) ─

class GoogleAuthRequest(BaseModel):
    token: str


@router.post("/google", response_model=AuthResponse)
def google_login(body: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Legacy: accepts a Google ID token from the browser-side GSI library.

    New deployments should use the PKCE flow (GET /login → POST /callback).
    This endpoint is retained so existing test infrastructure and any cached
    clients continue to work without changes.
    """
    try:
        google_info = verify_google_token(body.token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    from scaffold.providers.auth.base import UserIdentity
    identity = UserIdentity(
        provider_sub=google_info["sub"],
        email=google_info["email"],
        email_verified=True,
        name=google_info.get("name"),
        picture=google_info.get("picture"),
    )
    user = _upsert_user(identity, db)
    return AuthResponse(access_token=create_token(user.id))


# E2E test-only endpoint: creates a user without going through any IdP
if os.getenv("E2E_TEST") == "1":
    class TestLoginRequest(BaseModel):
        email: str
        name: str = "Test User"

    @router.post("/test-login", response_model=AuthResponse)
    def test_login(body: TestLoginRequest, db: Session = Depends(get_db)):
        user = db.query(User).filter(User.email == body.email).first()
        if not user:
            enc_key = encrypt_user_key(generate_user_key()) if encryption_enabled() else None
            user = User(
                email=body.email, google_id=f"test-{body.email}",
                name=body.name, encrypted_key=enc_key,
            )
            db.add(user)
            db.commit()
            db.refresh(user)

        user.is_admin = int(user.email.lower() in get_admin_emails())
        user.last_login = datetime.now(timezone.utc)
        db.commit()

        return AuthResponse(access_token=create_token(user.id))
