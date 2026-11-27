"""Reach an admin on the channels they chose: their push devices, and email
when their email notifications are on and the server can send email.

An approval code goes to push only. An assistant that also holds an email
connector could read its own code out of the inbox and approve itself, so
the email copy (`email_body`) must never carry one; for approvals it is a
notice linking to the browser approval instead.
"""
import html
import logging

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def deliver(db: Session, user, title: str, body: str, email_body: str | None = None,
            url: str | None = None) -> list[str]:
    """Push `body`; email `email_body` (default `body`). Returns the channels
    that accepted their message, e.g. ["push", "email"].

    `url` is a same-origin path the notification tap should open (the
    service worker's notificationclick routes on `data.url`). Without it
    a tap lands on the app home and the admin has to hunt for the thing
    the notification was about (#825)."""
    from scaffold.email_sender import email_configured, send_email
    from scaffold.models import EmailPreference, PushSubscription
    from scaffold.notifications import PushResult, send_push

    payload: dict = {"title": title, "body": body, "tag": "admin-approval"}
    if url:
        payload["data"] = {"url": url}

    channels: list[str] = []
    sent = 0
    for sub in db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all():
        result = send_push(sub, payload)
        if result is PushResult.SENT:
            sent += 1
        elif result is PushResult.GONE:
            db.delete(sub)
    db.commit()
    if sent:
        channels.append("push")

    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if pref and pref.enabled and email_configured():
        body = body if email_body is None else email_body
        page = (f'<div style="font-family: sans-serif; max-width: 480px;">'
                f'<h2 style="color: #4472C4;">{html.escape(title)}</h2>'
                f'<p style="color: #374151; white-space: pre-line;">{html.escape(body)}</p></div>')
        try:
            if send_email(user.email, title, body, page):
                channels.append("email")
        except Exception:
            logger.exception("Could not email an admin notice")
    return channels
