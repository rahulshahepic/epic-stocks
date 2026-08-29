from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, PushSubscription
from schemas import PushSubscriptionCreate, PushSubscriptionOut
from scaffold.auth import get_current_user

router = APIRouter(prefix="/api/push", tags=["push"])


@router.post("/subscribe", response_model=PushSubscriptionOut, status_code=201)
def subscribe(body: PushSubscriptionCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == user.id,
    ).first()
    if existing:
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
        user.notify_push_intent = 1
        db.commit()
        db.refresh(existing)
        return existing
    # If another user owns this endpoint, remove it (browser re-registration)
    stale = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if stale:
        db.delete(stale)
        db.flush()
    sub = PushSubscription(
        user_id=user.id,
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
    )
    db.add(sub)
    user.notify_push_intent = 1
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


class PushStatusRequest(BaseModel):
    # The calling device's own push endpoint, if it has one. Absent when the
    # device has no subscription at all.
    endpoint: str | None = None


class PushIntentRequest(BaseModel):
    enabled: bool


# POST rather than GET because the body carries the device's push endpoint,
# which is a device identifier we would rather not put in a URL and therefore
# in every access log. This is still a read: it changes nothing.
@router.post("/status")
def push_status(
    body: PushStatusRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Answer the two separate questions the UI needs.

    registered_here is device truth — whether *this* device is subscribed.
    total_devices counts every device the account has, which is context, never
    the toggle state: a count of 1 from a laptop must not make a phone that has
    never been asked look like push is already on.
    """
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
    endpoint = body.endpoint if body else None
    return {
        "registered_here": bool(endpoint) and any(s.endpoint == endpoint for s in subs),
        "total_devices": len(subs),
        "intent": bool(user.notify_push_intent),
    }


@router.put("/intent")
def set_push_intent(
    body: PushIntentRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Record whether to offer push on devices that have not been asked yet.

    Setting this false is "stop asking", not "turn push off" — existing device
    subscriptions are untouched and keep receiving.
    """
    user.notify_push_intent = int(body.enabled)
    db.commit()
    return {"intent": bool(user.notify_push_intent)}


@router.post("/test")
def push_test(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Send a test push notification to the current user's subscriptions."""
    from scaffold.notifications import send_push
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
    if not subs:
        raise HTTPException(status_code=404, detail="No push subscriptions found. Enable push notifications first.")
    payload = {"title": "Epic Stocks", "body": "Test notification — push is working!", "data": {"url": "/settings"}}
    from scaffold.notifications import PushResult
    sent = 0
    for sub in subs:
        result = send_push(sub, payload)
        if result is PushResult.SENT:
            sent += 1
        elif result is PushResult.GONE:
            db.delete(sub)
    db.commit()
    return {"sent": sent}
