"""Send an admin a one-time approval code on the channels they chose.

Follows the admin's own notification settings: every device they subscribed
for push, and email when their email notifications are on and the server can
send email. Nothing here decides what the code approves; it only delivers it.
"""
import html
import logging

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def deliver(db: Session, user, title: str, body: str) -> list[str]:
    """Returns the channels that accepted the message, e.g. ["push", "email"]."""
    from scaffold.email_sender import email_configured, send_email
    from scaffold.models import EmailPreference, PushSubscription
    from scaffold.notifications import PushResult, send_push

    channels: list[str] = []
    sent = 0
    for sub in db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all():
        result = send_push(sub, {"title": title, "body": body, "tag": "admin-approval"})
        if result is PushResult.SENT:
            sent += 1
        elif result is PushResult.GONE:
            db.delete(sub)
    db.commit()
    if sent:
        channels.append("push")

    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if pref and pref.enabled and email_configured():
        page = (f'<div style="font-family: sans-serif; max-width: 480px;">'
                f'<h2 style="color: #4472C4;">{html.escape(title)}</h2>'
                f'<p style="color: #374151; white-space: pre-line;">{html.escape(body)}</p></div>')
        try:
            if send_email(user.email, title, body, page):
                channels.append("email")
        except Exception:
            logger.exception("Could not email an approval code")
    return channels
