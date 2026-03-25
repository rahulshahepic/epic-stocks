from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from models import User, HorizonSettings
from schemas import HorizonSettingsRead, HorizonSettingsUpdate
from auth import get_current_user

router = APIRouter(prefix="/api/horizon-settings", tags=["horizon-settings"])


def _get_or_create(user: User, db: Session) -> HorizonSettings:
    hs = db.query(HorizonSettings).filter(HorizonSettings.user_id == user.id).first()
    if not hs:
        hs = HorizonSettings(user_id=user.id)
        db.add(hs)
        db.commit()
        db.refresh(hs)
    return hs


@router.get("", response_model=HorizonSettingsRead)
def get_horizon_settings(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _get_or_create(user, db)


@router.put("", response_model=HorizonSettingsRead)
def update_horizon_settings(body: HorizonSettingsUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    hs = _get_or_create(user, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(hs, k, v)
    db.commit()
    db.refresh(hs)
    return hs
