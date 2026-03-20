import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User, BlockedEmail
from schemas import GoogleAuthRequest, AuthResponse
from auth import verify_google_token, create_token, get_admin_emails
from crypto import encryption_enabled, generate_user_key, encrypt_user_key
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _notify_admin_new_user(user: User, db: Session):
    """Send admin email + check milestone (best-effort, never blocks login)."""
    try:
        from notifications import send_admin_new_user_notification, check_user_milestone
        send_admin_new_user_notification(user)
        check_user_milestone(db)
    except Exception:
        logger.exception("Failed to send admin notification for new user")


@router.post("/google", response_model=AuthResponse)
def google_login(body: GoogleAuthRequest, db: Session = Depends(get_db)):
    try:
        google_info = verify_google_token(body.token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    google_id = google_info["sub"]
    email = google_info["email"]
    name = google_info.get("name")
    picture = google_info.get("picture")

    blocked = db.query(BlockedEmail).filter(BlockedEmail.email == email.lower()).first()
    if blocked:
        raise HTTPException(status_code=403, detail="Account blocked")

    user = db.query(User).filter(User.google_id == google_id).first()
    if not user:
        enc_key = encrypt_user_key(generate_user_key()) if encryption_enabled() else None
        user = User(email=email, google_id=google_id, name=name, picture=picture, encrypted_key=enc_key)
        db.add(user)
        db.commit()
        db.refresh(user)
        _notify_admin_new_user(user, db)
    else:
        user.email = email
        user.name = name
        user.picture = picture
        db.commit()

    user.is_admin = user.email.lower() in get_admin_emails()
    user.last_login = datetime.now(timezone.utc)
    db.commit()

    return AuthResponse(access_token=create_token(user.id))


# E2E test-only endpoint: creates a user without Google OAuth
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

        user.is_admin = user.email.lower() in get_admin_emails()
        user.last_login = datetime.now(timezone.utc)
        db.commit()

        return AuthResponse(access_token=create_token(user.id))
