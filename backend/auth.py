import os
import hmac
import hashlib
import json
import base64
import time
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
import httpx

from database import get_db
from models import User
from crypto import encryption_enabled, decrypt_user_key, set_current_key

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_EXPIRE_HOURS = 24
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
def get_admin_email() -> str:
    return os.getenv("ADMIN_EMAIL", "")
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/google")


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


def verify_google_token(id_token: str) -> dict:
    resp = httpx.get(GOOGLE_TOKENINFO_URL, params={"id_token": id_token}, timeout=10)
    if resp.status_code != 200:
        raise ValueError("Invalid Google token")
    payload = resp.json()
    if payload.get("aud") != GOOGLE_CLIENT_ID:
        raise ValueError("Token not issued for this app")
    if payload.get("email_verified") != "true":
        raise ValueError("Email not verified")
    return payload


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = _decode_token(token)
        user_id = int(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if encryption_enabled() and user.encrypted_key:
        set_current_key(decrypt_user_key(user.encrypted_key))
    else:
        set_current_key(None)
    return user


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    """Verify the authenticated user is the admin. Checked against ADMIN_EMAIL on every request."""
    admin_email = get_admin_email()
    if not admin_email:
        raise HTTPException(status_code=403, detail="Admin not configured")
    if user.email.lower() != admin_email.lower():
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
