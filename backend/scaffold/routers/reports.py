"""User-submitted problem reports.

Open to anyone — someone who cannot sign in is exactly the person who most
needs to be able to tell us. What a report may carry is deliberately narrow:

  always      the message the person typed, the route they were on, the kind of
              failure (manual/toast/crash/import), the error_ref of the server
              exception behind it, and the error text the UI already showed them
  on request  their account (user_id/email), user agent, and the recent-activity
              log the client keeps — only when they tick "include details",
              which is off by default
  never       financial data of any kind, request or response bodies, tokens

The client is trusted to send no more than this; the caps here are what stops a
buggy or hostile client from turning a report into a dumping ground.
"""
import hashlib
import hmac
import logging
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, UserReport

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/report", tags=["reports"])

MAX_MESSAGE = 2000
MAX_ERROR_MESSAGE = 500
MAX_CLIENT_LOG = 8000
MAX_USER_AGENT = 400
SOURCES = {"manual", "toast", "crash", "import"}
_ERROR_REF_RE = re.compile(r"^[A-Za-z0-9-]{1,32}$")


class ReportRequest(BaseModel):
    message: str
    path: str | None = None
    source: str = "manual"
    error_ref: str | None = None
    error_message: str | None = None
    include_details: bool = False
    email: str | None = None
    user_agent: str | None = None
    app_version: str | None = None
    client_log: str | None = None


class ReportResponse(BaseModel):
    id: int
    error_ref: str | None = None


def _clip(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    return value[:limit]


def hash_ip(ip: str) -> str:
    """Salted hash of a client IP. Abuse control only — never reversible to an address."""
    from scaffold.auth import JWT_SECRET
    secret = os.getenv("UNSUBSCRIBE_SECRET", "") or JWT_SECRET
    return hmac.new(f"report:{secret}".encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


def _optional_user(request: Request, db: Session) -> User | None:
    """The signed-in user, or None. Never raises — a broken session still gets to report."""
    try:
        from scaffold.auth import _token_from_request, _decode_token
        token = _token_from_request(request)
        if not token:
            return None
        return db.get(User, int(_decode_token(token)["sub"]))
    except Exception:
        return None


@router.post("", response_model=ReportResponse)
def submit_report(body: ReportRequest, request: Request, db: Session = Depends(get_db)):
    message = _clip(body.message, MAX_MESSAGE)
    if not message:
        raise HTTPException(status_code=400, detail="Tell us what went wrong")

    user = _optional_user(request, db)

    # Two limits, because they catch different things. Behind Caddy, uvicorn runs
    # without --proxy-headers, so request.client.host is the proxy for everyone:
    # the IP limit is one shared bucket and has to be loose enough that a real
    # outage — when reports arrive in a burst — is not silenced by it. The
    # per-user limit is the precise one, and cannot be shared or spoofed.
    client_ip = request.client.host if request.client else "unknown"
    from scaffold.rate_limit import check_rate, check_rate_ip
    check_rate_ip(client_ip, "user_report", max_calls=30, window_secs=900)
    if user:
        check_rate(user.id, "user_report", max_calls=10, window_secs=900)
    include = bool(body.include_details)

    error_ref = _clip(body.error_ref, 32)
    if error_ref and not _ERROR_REF_RE.match(error_ref):
        error_ref = None

    report = UserReport(
        message=message,
        path=_clip(body.path, 200),
        source=body.source if body.source in SOURCES else "manual",
        error_ref=error_ref,
        error_message=_clip(body.error_message, MAX_ERROR_MESSAGE),
        include_details=include,
        # Identity is attached only on request. Without the tick the report is
        # stored anonymously even when it arrives on an authenticated session.
        user_id=user.id if (include and user) else None,
        email=_clip(body.email, 200) or (user.email if (include and user) else None),
        user_agent=_clip(body.user_agent, MAX_USER_AGENT) if include else None,
        app_version=_clip(body.app_version, 100),
        client_log=_clip(body.client_log, MAX_CLIENT_LOG) if include else None,
        ip_hash=hash_ip(client_ip),
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    _notify_admins(report)
    return ReportResponse(id=report.id, error_ref=report.error_ref)


def _notify_admins(report: UserReport) -> None:
    """Email the admins that a report landed. Best-effort — never fails the request."""
    try:
        from scaffold.auth import get_admin_emails
        from scaffold.email_sender import app_url, email_configured, send_email

        if not email_configured():
            return
        admins = get_admin_emails()
        if not admins:
            return

        who = report.email or (f"user {report.user_id}" if report.user_id else "anonymous")
        subject = f"Epic Stocks: problem report ({report.source})"
        lines = [
            f"From: {who}",
            f"Page: {report.path or 'unknown'}",
            f"Source: {report.source}",
        ]
        if report.error_ref:
            lines.append(f"Error ref: {report.error_ref}")
        if report.error_message:
            lines.append(f"Error shown: {report.error_message}")
        lines += ["", report.message, ""]
        base = app_url()
        if base:
            lines.append(f"Admin: {base}/admin")
        text = "\n".join(lines)
        for email in admins:
            send_email(email, subject, text)
    except Exception:
        logger.exception("Failed to send problem-report notification")
