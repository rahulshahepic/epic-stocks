import os
import hmac
import hashlib
import json
import base64
import time
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User
from scaffold.crypto import encryption_enabled, decrypt_user_key, set_current_key

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_EXPIRE_HOURS = 24
COOKIE_MAX_AGE = JWT_EXPIRE_HOURS * 3600


def get_admin_emails() -> set[str]:
    """Parse ADMIN_EMAIL env var (semicolon-delimited) into a set of lowercase emails."""
    raw = os.getenv("ADMIN_EMAIL", "")
    if not raw:
        return set()
    return {e.strip().lower() for e in raw.split(";") if e.strip()}


def cookie_secure() -> bool:
    """True when running behind HTTPS (production with DOMAIN set)."""
    return bool(os.getenv("DOMAIN"))


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * padding)


def create_token(user_id: int) -> str:
    header = _b64url_encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = _b64url_encode(json.dumps({"sub": str(user_id), "exp": int(exp.timestamp())}).encode())
    sig_input = f"{header}.{payload}".encode()
    signature = _b64url_encode(hmac.new(JWT_SECRET.encode(), sig_input, hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def _decode_token(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("bad token")
    sig_input = f"{parts[0]}.{parts[1]}".encode()
    expected = hmac.new(JWT_SECRET.encode(), sig_input, hashlib.sha256).digest()
    actual = _b64url_decode(parts[2])
    if not hmac.compare_digest(expected, actual):
        raise ValueError("bad signature")
    payload = json.loads(_b64url_decode(parts[1]))
    if payload.get("exp", 0) < time.time():
        raise ValueError("expired")
    return payload


def set_session_cookies(response, token: str) -> None:
    """Set the HttpOnly session cookie and a non-HttpOnly auth hint readable by JS."""
    secure = cookie_secure()
    response.set_cookie(
        key="session",
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        key="auth_hint",
        value="1",
        max_age=COOKIE_MAX_AGE,
        httponly=False,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookies(response) -> None:
    """Clear both auth cookies."""
    response.delete_cookie(key="session", path="/", httponly=True, samesite="lax")
    response.delete_cookie(key="auth_hint", path="/", httponly=False, samesite="lax")


def _token_from_request(request: Request) -> str | None:
    """Extract JWT from the HttpOnly session cookie — the only supported auth mechanism."""
    return request.cookies.get("session")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _token_from_request(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = _decode_token(token)
        user_id = int(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # Refresh admin flag on every request so env changes take effect immediately
    is_admin = user.email.lower() in get_admin_emails()
    if bool(user.is_admin) != is_admin:
        user.is_admin = is_admin
        db.commit()
    if encryption_enabled() and user.encrypted_key:
        set_current_key(decrypt_user_key(user.encrypted_key))
    else:
        set_current_key(None)
    return user


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    """Verify the authenticated user has the is_admin flag (set on login from ADMIN_EMAIL)."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
