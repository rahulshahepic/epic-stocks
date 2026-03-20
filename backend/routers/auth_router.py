from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import User
from schemas import GoogleAuthRequest, AuthResponse
from auth import verify_google_token, create_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


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

    user = db.query(User).filter(User.google_id == google_id).first()
    if not user:
        user = User(email=email, google_id=google_id, name=name, picture=picture)
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user.email = email
        user.name = name
        user.picture = picture
        db.commit()

    return AuthResponse(access_token=create_token(user.id))
