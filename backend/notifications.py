"""Push notification logic — daily check for today's events, send consolidated push per user."""
import json
import logging
import os
from collections import Counter
from datetime import date, datetime

from sqlalchemy.orm import Session

from database import SessionLocal
from models import User, Grant, Loan, Price, PushSubscription
from core import generate_all_events, compute_timeline

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_CLAIMS_EMAIL = os.getenv("VAPID_CLAIMS_EMAIL", "mailto:admin@example.com")

NOTIFY_EVENT_TYPES = {"Vesting", "Loan Repayment", "Exercise"}


def _user_source_data(user: User, db: Session):
    grants_db = db.query(Grant).filter(Grant.user_id == user.id).order_by(Grant.year).all()
    prices_db = db.query(Price).filter(Price.user_id == user.id).order_by(Price.effective_date).all()
    loans_db = db.query(Loan).filter(Loan.user_id == user.id).order_by(Loan.due_date).all()

    grants = [{
        "year": g.year, "type": g.type, "shares": g.shares, "price": g.price,
        "vest_start": datetime.combine(g.vest_start, datetime.min.time()),
        "periods": g.periods,
        "exercise_date": datetime.combine(g.exercise_date, datetime.min.time()),
        "dp_shares": g.dp_shares or 0,
    } for g in grants_db]

    prices = [{"date": datetime.combine(p.effective_date, datetime.min.time()), "price": p.price} for p in prices_db]

    loans = [{
        "grant_yr": ln.grant_year, "grant_type": ln.grant_type,
        "loan_type": ln.loan_type, "loan_year": ln.loan_year,
        "amount": ln.amount, "interest_rate": ln.interest_rate,
        "due": datetime.combine(ln.due_date, datetime.min.time()),
        "loan_number": ln.loan_number,
    } for ln in loans_db]

    initial_price = prices[0]["price"] if prices else 0
    return grants, prices, loans, initial_price


def get_todays_events_for_user(user: User, db: Session, today: date | None = None) -> list[dict]:
    today = today or date.today()
    grants, prices, loans, initial_price = _user_source_data(user, db)
    if not grants and not prices:
        return []
    events = generate_all_events(grants, prices, loans)
    timeline = compute_timeline(events, initial_price)

    todays = []
    for e in timeline:
        edate = e["date"]
        if isinstance(edate, datetime):
            edate = edate.date()
        if edate == today and e["event_type"] in NOTIFY_EVENT_TYPES:
            todays.append(e)
    return todays


def build_notification_payload(events: list[dict]) -> dict | None:
    if not events:
        return None
    counts = Counter(e["event_type"] for e in events)
    total = sum(counts.values())
    parts = [f"{count} {etype}" for etype, count in sorted(counts.items())]
    body = f"You have {total} event{'s' if total != 1 else ''} today: {', '.join(parts)}"
    return {"title": "Equity Tracker", "body": body}


def send_push(subscription: PushSubscription, payload: dict) -> bool:
    if not VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY not set, skipping push")
        return False
    try:
        from py_vapid import Vapid
        import httpx

        vapid = Vapid.from_string(VAPID_PRIVATE_KEY)
        headers = vapid.sign({
            "sub": VAPID_CLAIMS_EMAIL,
            "aud": _get_origin(subscription.endpoint),
        })
        # For simplicity, send unencrypted JSON payload via TTL-based push
        # Real encryption would use RFC 8291, but most push services accept
        # plaintext with proper VAPID auth
        resp = httpx.post(
            subscription.endpoint,
            content=json.dumps(payload).encode(),
            headers={
                "Authorization": headers["Authorization"],
                "TTL": "86400",
                "Content-Type": "application/json",
                "Urgency": "normal",
            },
            timeout=10,
        )
        if resp.status_code in (404, 410):
            return False  # subscription expired
        resp.raise_for_status()
        return True
    except Exception:
        logger.exception("Failed to send push notification")
        return False


def _get_origin(url: str) -> str:
    from urllib.parse import urlparse
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def send_daily_notifications(today: date | None = None):
    """Check all users with push subscriptions and send one notification per user."""
    today = today or date.today()
    db = SessionLocal()
    try:
        users_with_subs = (
            db.query(User)
            .join(PushSubscription)
            .distinct()
            .all()
        )
        for user in users_with_subs:
            events = get_todays_events_for_user(user, db, today)
            payload = build_notification_payload(events)
            if not payload:
                continue
            subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
            for sub in subs:
                ok = send_push(sub, payload)
                if not ok:
                    db.delete(sub)
            db.commit()
    except Exception:
        logger.exception("Error in daily notification check")
    finally:
        db.close()
