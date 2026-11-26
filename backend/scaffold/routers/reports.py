"""Anonymous reports plus separately consented, encrypted support material."""
import asyncio
import hashlib
import hmac
import logging
import os
import re
from threading import BoundedSemaphore

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from scaffold.models import User, UserReport
from scaffold import sensitive_reports
from scaffold.auth import get_session_user
from scaffold.client_ip import client_ip
from scaffold.rate_limit import check_rate, check_rate_ip_shared

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/report", tags=["reports"])

MAX_MESSAGE = 2000
MAX_ERROR_MESSAGE = 500
MAX_CLIENT_LOG = 8000
MAX_USER_AGENT = 400
SOURCES = {"manual", "toast", "crash", "import", "request"}
_ERROR_REF_RE = re.compile(r"^[A-Za-z0-9-]{1,32}$")
_RULE = r"[A-Z][0-9]{1,2}\((?:error|warning|info)\)(?: ×[0-9]{1,4})?"
_SAFE_ERROR = re.compile(rf"(?:Error [45][0-9]{{2}}|(?:blocked import|import findings): (?:none|{_RULE}(?:, {_RULE})*))")


class ReportRequest(BaseModel):
    message: str
    path: str | None = None
    source: str = "manual"
    error_ref: str | None = None
    error_message: str | None = None
    include_details: bool = False
    share_diagnostics: bool = False
    attach_documents: bool = False
    email: str | None = None
    app_version: str | None = None


class ReportDocument(BaseModel):
    name: str = Field(max_length=240)
    base64: str = Field(max_length=sensitive_reports.MAX_BASE64)


class ConsentedReportRequest(ReportRequest):
    user_agent: str | None = None
    client_log: str | None = None
    workflow: str | None = Field(default=None, max_length=24_000)
    documents: list[ReportDocument] = Field(default_factory=list, max_length=sensitive_reports.MAX_FILES)


_sensitive_slots = BoundedSemaphore(2)


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
        return get_session_user(request, db)
    except HTTPException:
        return None


@router.post("", response_model=ReportResponse)
def submit_report(body: ReportRequest, request: Request, db: Session = Depends(get_db)):
    message = _clip(body.message, MAX_MESSAGE)
    if not message:
        raise HTTPException(status_code=400, detail="Tell us what went wrong")

    user = _optional_user(request, db)

    # Two limits, because they catch different things. The IP limit is loose
    # enough that a real outage — when reports arrive in a burst — is not
    # silenced by it; the per-user limit is the precise one, and cannot be
    # shared or spoofed. The address comes from scaffold.client_ip, which
    # unwraps X-Forwarded-For only as far as TRUSTED_PROXY_HOPS allows; before
    # that this was the proxy's address for every reporter, so the IP limit was
    # a single global bucket.
    ip = client_ip(request)
    check_rate_ip_shared(ip, "user_report", max_calls=200, window_secs=900)
    if user:
        check_rate(user.id, "user_report", max_calls=10, window_secs=900)
    if body.include_details:
        raise HTTPException(400, "Reload to use the new diagnostic consent, or clear Include details to send anonymously.")
    if body.share_diagnostics or body.attach_documents:
        raise HTTPException(400, "Use the private report form to include diagnostics or documents.")

    error_ref = _clip(body.error_ref, 32)
    if error_ref and not _ERROR_REF_RE.match(error_ref):
        error_ref = None

    error_message = _clip(body.error_message, MAX_ERROR_MESSAGE)
    if error_message and not _SAFE_ERROR.fullmatch(error_message):
        error_message = None

    report = UserReport(
        message=message,
        path=_clip((body.path or "").split("?")[0].split("#")[0], 200),
        source=body.source if body.source in SOURCES else "manual",
        error_ref=error_ref,
        error_message=error_message,
        email=_clip(body.email, 200),
        app_version=_clip(body.app_version, 100),
        ip_hash=hash_ip(ip),
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    _notify_admins(report)
    return ReportResponse(id=report.id, error_ref=report.error_ref)


@router.post("/with-consent", response_model=ReportResponse)
async def submit_consented_report(request: Request, db: Session = Depends(get_db)):
    # JSON keeps originals in memory until encrypted; the multipart parser
    # would spool larger files to a plaintext temporary file.
    if request.headers.get("content-type", "").partition(";")[0].lower() != "application/json":
        raise HTTPException(415, "Private reports require JSON")
    if not _sensitive_slots.acquire(blocking=False):
        raise HTTPException(503, "Reporting is busy. Try again shortly.", headers={"Retry-After": "5"})
    try:
        check_rate_ip_shared(client_ip(request), "sensitive_report", max_calls=60, window_secs=900)
        try:
            raw = await asyncio.wait_for(request.body(), timeout=30)
            body = ConsentedReportRequest.model_validate_json(raw)
        except TimeoutError:
            raise HTTPException(408, "The private report took too long to upload") from None
        except (ValueError, RecursionError):
            # FastAPI's default validation response can include the rejected input.
            raise HTTPException(422, "Some private report fields are invalid or too large") from None
        return await run_in_threadpool(_submit_consented, body, request, db)
    finally:
        _sensitive_slots.release()


def _submit_consented(body, request, db):
    message = _clip(body.message, MAX_MESSAGE)
    if not message:
        raise HTTPException(400, "Tell us what went wrong")
    if not (body.share_diagnostics or body.attach_documents):
        raise HTTPException(400, "Choose what to share with this private report")
    if body.documents and not body.attach_documents:
        raise HTTPException(400, "Consent is required to attach documents")
    if body.attach_documents and (body.source != "import" or not body.documents):
        raise HTTPException(400, "Choose at least one import document to attach")

    try:
        user = _optional_user(request, db)
        if user:
            check_rate(user.id, "sensitive_report", max_calls=5, window_secs=900)
            # Account deletion locks this row before scanning reports.
            user_id = db.scalar(select(User.id).where(User.id == user.id).with_for_update())
            if user_id is None:
                raise HTTPException(401, "This session has ended. Reload and try again.")
        else:
            user_id = None
        documents = sensitive_reports.validate_documents(body.documents)
        ref = _clip(body.error_ref, 32)
        if ref and not _ERROR_REF_RE.fullmatch(ref):
            ref = None
        source = body.source if body.source in SOURCES else "manual"
        details = {
            "message": message, "source": source, "error_ref": ref,
            "path": _clip((body.path or "").split("?")[0].split("#")[0], 200),
            "app_version": _clip(body.app_version, 100),
            "email": _clip(body.email, 200),
            "shared_diagnostics": body.share_diagnostics,
            "shared_documents": body.attach_documents,
        }
        if body.share_diagnostics:
            from scaffold.synthetic_accounts import requires_synthetic
            if user and not requires_synthetic():
                details["account"] = {"id": user.id, "email": user.email}
            elif user:
                details["account"] = {"environment": "fictional staging workspace"}
            details.update(
                user_agent=_clip(body.user_agent, MAX_USER_AGENT),
                recent_activity=_clip(body.client_log, MAX_CLIENT_LOG),
                error_shown=_clip(body.error_message, MAX_ERROR_MESSAGE),
                workflow=_clip(body.workflow, 24_000),
            )
        report = UserReport(message=sensitive_reports.STUB_MESSAGE, source=source)
        sensitive_reports.store(db, report, user_id=user_id, details=details, documents=documents)
    except HTTPException:
        raise
    except sensitive_reports.Unavailable as exc:
        db.rollback()
        raise HTTPException(503, str(exc)) from None
    except ValueError:
        db.rollback()
        # This path only surfaces fixed text from file validation.
        raise HTTPException(400, "Check the file types and sizes of your attachments") from None
    except Exception:
        db.rollback()
        logger.error("Could not store consented report")
        raise HTTPException(500, "Could not send private report") from None

    _notify_admins(report)
    return ReportResponse(id=report.id, error_ref=ref)


def _notify_admins(report: UserReport) -> None:
    """Notify without copying any report contents into email."""
    try:
        from scaffold.auth import get_admin_emails
        from scaffold.email_sender import app_url, email_configured, send_email

        if not email_configured():
            return
        base = app_url()
        text = f"Problem report #{report.id} is available in Site Admin → Reports & Errors."
        if base:
            text += f"\n\n{base}/admin#support"
        for email in get_admin_emails():
            send_email(email, "Epic Stocks: new problem report", text)
    except Exception:
        logger.warning("Could not send problem-report notification")
