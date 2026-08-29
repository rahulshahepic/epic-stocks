import os
from datetime import datetime, timezone
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, BlockedEmail, EmailPreference
from scaffold.auth import create_token, get_admin_emails, set_session_cookies, clear_session_cookies, get_current_user
from scaffold.crypto import encryption_enabled, generate_user_key, encrypt_user_key
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _allowed_redirect_origins() -> list[str]:
    domain = os.getenv("DOMAIN", "")
    if domain:
        return [f"https://{domain}"]
    return ["http://localhost", "http://127.0.0.1"]


def _validate_redirect_uri(redirect_uri: str) -> None:
    """Reject redirect_uri values that don't match the server's known origins.

    Skip in E2E_TEST so tests can pass any URI; in production, only the
    registered DOMAIN is accepted; in local dev, only localhost is accepted.
    """
    if os.getenv("E2E_TEST") == "1":
        return
    try:
        parsed = urlparse(redirect_uri)
        origin = f"{parsed.scheme}://{parsed.hostname}"
        if parsed.port:
            origin += f":{parsed.port}"
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid redirect_uri")
    if os.getenv("DOMAIN"):
        # Production: exact scheme+hostname+port match against the registered domain
        allowed = _allowed_redirect_origins()
        if origin not in allowed:
            raise HTTPException(status_code=400, detail="redirect_uri not allowed")
    else:
        # Dev: allow any port on localhost / 127.0.0.1 only
        if parsed.hostname not in ("localhost", "127.0.0.1"):
            raise HTTPException(status_code=400, detail="redirect_uri not allowed")


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
    if not identity.email_verified:
        raise HTTPException(status_code=403, detail="Email address is not verified by the identity provider")
    email = identity.email
    check_email = email.lower()

    blocked = db.query(BlockedEmail).filter(BlockedEmail.email == check_email).first()
    if blocked:
        raise HTTPException(status_code=403, detail="Account blocked")

    user = db.query(User).filter(
        User.provider_name == identity.provider_name,
        User.google_id == identity.provider_sub,
    ).first()
    if not user:
        enc_key = encrypt_user_key(generate_user_key()) if encryption_enabled() else None
        user = User(
            email=email,
            provider_name=identity.provider_name,
            google_id=identity.provider_sub,
            name=identity.name,
            picture=identity.picture,
            encrypted_key=enc_key,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        # Enable email notifications by default for new users
        db.add(EmailPreference(user_id=user.id, enabled=1))
        db.commit()
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
def login_start(provider: str, code_challenge: str, redirect_uri: str, state: str, request: Request):
    """Return the IdP authorization URL for the given provider."""
    _validate_redirect_uri(redirect_uri)
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
    # Cookie-less clients (a native shell, whose WebView origin is not the
    # server's) ask for the JWT in the response body instead. Opting in rather
    # than always returning it keeps the token out of reach of script on the
    # web app, which has the HttpOnly cookie and never needs to read one.
    return_token: bool = False


@router.post("/callback")
def auth_callback(body: CallbackRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    """Exchange PKCE authorization code for a JWT; set it as an HttpOnly session cookie."""
    from scaffold.rate_limit import check_rate_ip
    client_ip = request.client.host if request.client else "unknown"
    check_rate_ip(client_ip, "auth_callback", max_calls=20, window_secs=900)
    _validate_redirect_uri(body.redirect_uri)
    from scaffold.providers.auth import get_provider
    from scaffold.providers.auth.base import UserIdentity
    try:
        p = get_provider(body.provider)
        identity: UserIdentity = p.exchange_code(body.code, body.code_verifier, body.redirect_uri)
    except ValueError as e:
        logger.warning("Auth callback error for provider %r: %s", body.provider, e)
        raise HTTPException(status_code=401, detail="Authentication failed")
    user = _upsert_user(identity, db)
    token = create_token(user.id, user.session_version)
    set_session_cookies(response, token)
    if body.return_token:
        return {"ok": True, "access_token": token}
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    """Clear the session cookie."""
    clear_session_cookies(response)
    return {"ok": True}


@router.post("/refresh")
def refresh(request: Request, response: Response, user: User = Depends(get_current_user)):
    """Re-issue the session cookie with a fresh expiry. Sliding-session refresh:
    the frontend calls this on app mount and on visibility change so active
    users effectively never get logged out, while genuinely inactive sessions
    still expire after the cookie max_age.

    siat (session-issued-at) is carried forward unchanged so the absolute
    session ceiling is enforced regardless of how many times the token is refreshed.
    """
    from scaffold.auth import _decode_token, _token_from_request
    existing_siat = None
    try:
        token = _token_from_request(request)
        if token:
            existing_siat = int(_decode_token(token).get("siat", 0)) or None
    except Exception:
        pass
    set_session_cookies(response, create_token(user.id, user.session_version, siat=existing_siat))
    return {"ok": True}


@router.post("/logout-everywhere")
def logout_everywhere(
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Invalidate every outstanding session for this user by bumping
    session_version. The current cookie is also cleared."""
    user.session_version = int(user.session_version) + 1
    db.commit()
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
        if os.getenv("DOMAIN") or os.getenv("APP_ENV") == "production":
            raise HTTPException(status_code=403, detail="Not available in production")
        from sqlalchemy.exc import IntegrityError
        blocked = db.query(BlockedEmail).filter(BlockedEmail.email == body.email.lower()).first()
        if blocked:
            raise HTTPException(status_code=403, detail="Account blocked")
        is_new = False
        # Retry loop handles the race where two workers simultaneously try to create
        # the same user (admin@e2e.test). On IntegrityError the loser rolls back and
        # re-fetches the row the winner just committed.
        for _attempt in range(3):
            user = db.query(User).filter(User.email == body.email).first()
            if not user:
                enc_key = encrypt_user_key(generate_user_key()) if encryption_enabled() else None
                try:
                    user = User(
                        email=body.email,
                        provider_name="test",
                        google_id=f"test-{body.email}",
                        name=body.name,
                        encrypted_key=enc_key,
                    )
                    db.add(user)
                    db.flush()  # raises IntegrityError if concurrent worker won the race
                    db.add(EmailPreference(user_id=user.id, enabled=1))
                    is_new = True
                except IntegrityError:
                    db.rollback()
                    is_new = False
                    continue  # re-query on next iteration
            break
        admin_emails = get_admin_emails()
        user.is_admin = int(body.email.lower() in {e.lower() for e in admin_emails})
        user.last_login = datetime.now(timezone.utc)
        db.commit()
        if is_new:
            _notify_admin_new_user(user, db)
        set_session_cookies(response, create_token(user.id, user.session_version))
        return {"ok": True}
