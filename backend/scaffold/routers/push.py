from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, PushSubscription
from schemas import PushSubscriptionCreate, PushSubscriptionOut
from scaffold.auth import get_current_user

router = APIRouter(prefix="/api/push", tags=["push"])


@router.post("/subscribe", response_model=PushSubscriptionOut, status_code=201)
def subscribe(body: PushSubscriptionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if existing:
        existing.user_id = user.id
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
        db.commit()
        db.refresh(existing)
        return existing
    sub = PushSubscription(
        user_id=user.id,
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


@router.delete("/subscribe", status_code=204)
def unsubscribe(body: PushSubscriptionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == user.id,
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    db.delete(sub)
    db.commit()


@router.get("/status")
def push_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).count()
    return {"subscribed": count > 0, "subscription_count": count}


@router.post("/test")
def push_test(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Send a test push notification to the current user's subscriptions."""
    from scaffold.notifications import send_push
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
    if not subs:
        raise HTTPException(status_code=404, detail="No push subscriptions found. Enable push notifications first.")
    payload = {"title": "Equity Tracker", "body": "Test notification — push is working!"}
    sent = 0
    for sub in subs:
        ok = send_push(sub, payload)
        if ok:
            sent += 1
        elif ok is False:
            db.delete(sub)
    db.commit()
    return {"sent": sent}
