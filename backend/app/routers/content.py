"""Read-only content endpoints for the wizard.

Phase 1 exposes only GET /api/content; write endpoints (for content admins)
land in Phase 2.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User
from scaffold.auth import get_current_user
from app.content_service import load_content

router = APIRouter(prefix="/api/content", tags=["content"])


@router.get("")
def get_content(
    _user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """Return the full wizard content blob (grant schedule, loan rates, refi chains, etc.).

    Every logged-in user can read this — the content is global, not per-user.
    """
    return load_content(db)
