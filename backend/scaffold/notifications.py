"""Notification logic — daily check for today's events, send push + email per user."""
import html as _html
import json
from enum import Enum
import logging
import os
from collections import Counter
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from database import SessionLocal
from scaffold.models import User, Grant, Loan, Price, PushSubscription, EmailPreference, Sale
from services.timeline_cache import get_timeline

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")

def _vapid_claims_email() -> str:
    raw = os.getenv("ADMIN_EMAIL", "")
    first = next((e.strip() for e in raw.split(";") if e.strip()), "")
    return f"mailto:{first}" if first else "mailto:admin@localhost"

NOTIFY_EVENT_TYPES = {"Vesting", "Loan Repayment", "Exercise", "Sale"}


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


def get_todays_events_for_user(user: User, db: Session, today: date | None = None, advance_days: int = 0) -> list[dict]:
    today = today or date.today()
    target_date = today + timedelta(days=advance_days)
    todays = []

    grants, prices, loans, initial_price = _user_source_data(user, db)
    if grants and prices:
        timeline = get_timeline(user.id, grants, prices, loans, initial_price)
        for e in timeline:
            edate = e["date"]
            if isinstance(edate, datetime):
                edate = edate.date()
            if edate == target_date and e["event_type"] in NOTIFY_EVENT_TYPES:
                todays.append(e)

    sales = db.query(Sale).filter(Sale.user_id == user.id, Sale.date == target_date).all()
    for s in sales:
        todays.append({
            "event_type": "Sale",
            "date": target_date,
            "shares": s.shares,
            "price_per_share": s.price_per_share,
        })

    return todays


def build_notification_payload(events: list[dict], target_date: date | None = None) -> dict | None:
    if not events:
        return None
    counts = Counter(e["event_type"] for e in events)
    total = sum(counts.values())
    parts = [f"{count} {etype}" for etype, count in sorted(counts.items())]
    body = f"You have {total} event{'s' if total != 1 else ''} today: {', '.join(parts)}"
    payload: dict = {"title": "Upcoming Events", "body": body}
    if target_date is not None:
        url = f"/events?date={target_date.isoformat()}&types={','.join(sorted(counts.keys()))}"
        payload["data"] = {"url": url}
    return payload


class PushResult(str, Enum):
    """Outcome of one push send.

    GONE is the only outcome that justifies deleting a subscription. Treating
    every failure as GONE meant a single timeout, a 500 from the push service,
    or a missing VAPID key silently unsubscribed the device for good — and in
    the missing-key case, every device of every user in one pass.
    """

    SENT = "sent"
    FAILED = "failed"   # transient — keep the subscription and try again next time
    GONE = "gone"       # the push service says this subscription no longer exists


def send_push(subscription: PushSubscription, payload: dict) -> PushResult:
    if not VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY not set, skipping push")
        return PushResult.FAILED
    # Re-checked here and not only at subscribe time: DNS moves. A host that
    # was public when the subscription was stored can point at loopback or the
    # metadata service months later, and subscriptions are long-lived.
    from scaffold.push_endpoints import is_sendable
    if not is_sendable(subscription.endpoint):
        logger.warning("Refusing to send push to a non-public endpoint")
        return PushResult.FAILED
    try:
        from pywebpush import webpush, WebPushException

        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": _vapid_claims_email()},
            ttl=86400,
            timeout=10,
        )
        return PushResult.SENT
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            return PushResult.GONE
        logger.exception("Failed to send push notification (status=%s)", status)
        return PushResult.FAILED
    except Exception:
        logger.exception("Failed to send push notification")
        return PushResult.FAILED


def _already_notified_today(user: User, today: date) -> bool:
    """Check if we already sent notifications to this user today."""
    if not user.last_notified_at:
        return False
    return user.last_notified_at.date() >= today


def send_daily_notifications(today: date | None = None):
    """Check all users and send push + email notifications as appropriate.

    Uses last_notified_at to ensure at most one notification batch per user per day.
    In multi-replica deployments, uses a PostgreSQL advisory lock so only one
    replica runs this job per firing.
    """
    today = today or date.today()
    db = SessionLocal()
    lock_acquired = False
    try:
        import database as _db_module
        from sqlalchemy import text as _text
        if not _db_module._is_sqlite:
            lock_acquired = db.execute(_text("SELECT pg_try_advisory_lock(111111111)")).scalar()
            if not lock_acquired:
                return  # another replica is running this job

        # Get all users who have push subscriptions OR email notifications enabled
        push_user_ids = {row[0] for row in db.query(PushSubscription.user_id).distinct().all()}
        email_user_ids = {row[0] for row in db.query(EmailPreference.user_id).filter(EmailPreference.enabled == 1).all()}
        all_user_ids = push_user_ids | email_user_ids

        if not all_user_ids:
            return

        users = db.query(User).filter(User.id.in_(all_user_ids)).all()

        # Build a map of user_id → advance_days preference
        all_prefs = {p.user_id: (p.advance_days or 0) for p in db.query(EmailPreference).filter(EmailPreference.user_id.in_(all_user_ids)).all()}

        from scaffold.crypto import encryption_enabled, decrypt_user_key, set_current_key

        for user in users:
            if _already_notified_today(user, today):
                continue

            # This job runs outside any request, so EncryptionMiddleware has not
            # put a key in context. Without this the user's own grants and prices
            # read back as zeros and everyone gets a notification computed from
            # nothing — the shared-data loop below already did this per owner.
            if encryption_enabled() and user.encrypted_key:
                set_current_key(decrypt_user_key(user.encrypted_key))
            else:
                set_current_key(None)

            advance_days = all_prefs.get(user.id, 0)
            target_date = today + timedelta(days=advance_days)
            events = get_todays_events_for_user(user, db, today, advance_days=advance_days)
            if not events:
                continue

            # Push notifications
            if user.id in push_user_ids:
                payload = build_notification_payload(events, target_date=target_date)
                if payload:
                    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
                    for sub in subs:
                        if send_push(sub, payload) is PushResult.GONE:
                            db.delete(sub)

            # Email notifications
            if user.id in email_user_ids:
                from scaffold.email_sender import build_event_email, send_email, email_configured
                if email_configured():
                    subject, text, html, hdrs = build_event_email(events, recipient_email=user.email)
                    send_email(user.email, subject, text, html, headers=hdrs)

            user.last_notified_at = datetime.now(timezone.utc)

        # ── Shared-data notifications ──────────────────────────────────────
        # Viewers who have accepted invitations with notify_enabled get notified
        # about events in the inviter's data.
        try:
            from scaffold.models import Invitation

            accepted_invs = db.query(Invitation).filter(
                Invitation.status == "accepted",
                Invitation.notify_enabled == 1,
                Invitation.invitee_id.isnot(None),
            ).all()

            # Group by viewer (invitee_id)
            viewer_events: dict[int, list[dict]] = {}
            for inv in accepted_invs:
                viewer_id = inv.invitee_id
                if viewer_id not in all_user_ids:
                    continue  # viewer has no notification prefs

                owner = db.get(User, inv.inviter_id)
                if not owner:
                    continue

                # Switch encryption context to owner
                if encryption_enabled() and owner.encrypted_key:
                    set_current_key(decrypt_user_key(owner.encrypted_key))
                else:
                    set_current_key(None)

                viewer_advance = all_prefs.get(viewer_id, 0)
                shared_events = get_todays_events_for_user(owner, db, today, advance_days=viewer_advance)
                if shared_events:
                    owner_name = owner.name or owner.email
                    if viewer_id not in viewer_events:
                        viewer_events[viewer_id] = []
                    for ev in shared_events:
                        ev["_shared_owner"] = owner_name
                    viewer_events[viewer_id].extend(shared_events)

            # Build a map of viewer_id → list of invitation_ids (for deep linking)
            viewer_invitations: dict[int, list[int]] = {}
            for inv in accepted_invs:
                if inv.invitee_id in viewer_events:
                    viewer_invitations.setdefault(inv.invitee_id, []).append(inv.id)

            for viewer_id, shared_evts in viewer_events.items():
                viewer = db.get(User, viewer_id)
                if not viewer:
                    continue

                owners = sorted(set(e.get("_shared_owner", "") for e in shared_evts))
                counts = Counter(e["event_type"] for e in shared_evts)
                total = sum(counts.values())
                parts = [f"{count} {etype}" for etype, count in sorted(counts.items())]
                owner_str = ', '.join(owners)
                body = f"{owner_str}: {total} event{'s' if total != 1 else ''} today — {', '.join(parts)}"
                payload: dict = {"title": "Shared Data Events", "body": body}

                # Deep link: single owner → dashboard (where account switcher shows them)
                inv_ids = viewer_invitations.get(viewer_id, [])
                payload["data"] = {"url": "/"}

                if viewer_id in push_user_ids:
                    subs = db.query(PushSubscription).filter(PushSubscription.user_id == viewer_id).all()
                    for sub in subs:
                        if send_push(sub, payload) is PushResult.GONE:
                            db.delete(sub)

                if viewer_id in email_user_ids:
                    from scaffold.email_sender import send_email, email_configured
                    if email_configured():
                        send_email(viewer.email, f"Epic Stocks: {owner_str} has events today", body)
        except Exception:
            logger.exception("Error sending shared-data notifications")

        db.commit()
    except Exception:
        logger.exception("Error in daily notification check")
    finally:
        # This job hops between users' keys; never leave one in the contextvar.
        try:
            from scaffold.crypto import set_current_key as _clear_key
            _clear_key(None)
        except Exception:
            pass
        # Explicitly release the advisory lock so it doesn't persist on pooled connections
        if lock_acquired:
            try:
                from sqlalchemy import text as _text
                db.execute(_text("SELECT pg_advisory_unlock(111111111)"))
                db.commit()
            except Exception:
                pass
        db.close()


def send_admin_new_user_notification(user: User):
    """Notify admins when a new user signs up. Called from auth_router."""
    from scaffold.auth import get_admin_emails
    from scaffold.email_sender import send_email, email_configured
    if not email_configured():
        return

    admin_emails = get_admin_emails()
    if not admin_emails:
        return

    safe_email = _html.escape(user.email)
    safe_name = _html.escape(user.name or "N/A")
    subject = f"Epic Stocks: New user signup — {user.email}"
    text = f"New user registered:\n\nName: {user.name or 'N/A'}\nEmail: {user.email}\n"
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Epic Stocks — New User</h2>
  <p>A new user has registered:</p>
  <table style="border-collapse: collapse;">
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Name</td><td>{safe_name}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Email</td><td>{safe_email}</td></tr>
  </table>
</div>"""

    for admin_email in admin_emails:
        send_email(admin_email, subject, text, html)


def send_admin_milestone_notification(total_users: int):
    """Notify admins when user count hits a milestone (10, 25, 50, 100, 250, ...)."""
    from scaffold.auth import get_admin_emails
    from scaffold.email_sender import send_email, email_configured
    if not email_configured():
        return

    admin_emails = get_admin_emails()
    if not admin_emails:
        return

    subject = f"Epic Stocks: Milestone — {total_users} users!"
    text = f"Congratulations! Your Epic Stocks instance now has {total_users} registered users."
    html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Epic Stocks — Milestone</h2>
  <p>Your instance now has <strong>{total_users}</strong> registered users!</p>
</div>"""

    for admin_email in admin_emails:
        send_email(admin_email, subject, text, html)


MILESTONES = {10, 25, 50, 100, 250, 500, 1000}


def check_user_milestone(db: Session):
    """Check if total user count just hit a milestone."""
    total = db.query(func.count(User.id)).scalar()
    if total in MILESTONES:
        send_admin_milestone_notification(total)


def send_admin_daily_digest():
    """Send a daily system health digest to admins.

    In multi-replica deployments, uses a PostgreSQL advisory lock so only one
    replica sends the digest per firing.
    """
    from scaffold.auth import get_admin_emails
    from scaffold.email_sender import send_email, email_configured
    from datetime import timedelta

    if not email_configured():
        return

    admin_emails = get_admin_emails()
    if not admin_emails:
        return

    db = SessionLocal()
    lock_acquired = False
    try:
        import database as _db_module
        from sqlalchemy import text as _text
        if not _db_module._is_sqlite:
            lock_acquired = db.execute(_text("SELECT pg_try_advisory_lock(333333333)")).scalar()
            if not lock_acquired:
                db.close()
                return  # another replica is running this job

        now = datetime.now(timezone.utc)
        yesterday = now - timedelta(days=1)

        total_users = db.query(func.count(User.id)).scalar()
        new_signups = db.query(func.count(User.id)).filter(User.created_at >= yesterday).scalar()
        active_24h = db.query(func.count(User.id)).filter(User.last_login >= yesterday).scalar()
        total_grants = db.query(func.count(Grant.id)).scalar()
        total_loans = db.query(func.count(Loan.id)).scalar()
        total_prices = db.query(func.count(Price.id)).scalar()
        from scaffold.models import UserReport
        open_reports = db.query(func.count(UserReport.id)).filter(UserReport.status == "new").scalar() or 0

        subject = f"Epic Stocks: Daily digest — {total_users} users"
        text = (
            f"Daily System Digest\n\n"
            f"Total users: {total_users}\n"
            f"New signups (24h): {new_signups}\n"
            f"Active users (24h): {active_24h}\n"
            f"Total grants: {total_grants}\n"
            f"Total loans: {total_loans}\n"
            f"Total prices: {total_prices}\n"
            f"Open problem reports: {open_reports}\n"
        )
        html = f"""<div style="font-family: sans-serif; max-width: 480px;">
  <h2 style="color: #4472C4;">Epic Stocks — Daily Digest</h2>
  <table style="border-collapse: collapse;">
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Total users</td><td>{total_users}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">New signups (24h)</td><td>{new_signups}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Active users (24h)</td><td>{active_24h}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Total grants</td><td>{total_grants}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Total loans</td><td>{total_loans}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Total prices</td><td>{total_prices}</td></tr>
    <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Open problem reports</td><td>{open_reports}</td></tr>
  </table>
</div>"""

        for admin_email in admin_emails:
            send_email(admin_email, subject, text, html)
    except Exception:
        logger.exception("Error sending admin daily digest")
    finally:
        # Explicitly release the advisory lock so it doesn't persist on pooled connections
        if lock_acquired:
            try:
                from sqlalchemy import text as _text
                db.execute(_text("SELECT pg_advisory_unlock(333333333)"))
                db.commit()
            except Exception:
                pass
        db.close()
