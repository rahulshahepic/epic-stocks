import logging
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, Request
from sqlalchemy.orm import Session
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
import database

logger = logging.getLogger(__name__)
from routers import auth_router, grants, loans, prices, events, flows, import_export, push, admin, notifications, sales
from auth import get_current_user
from crypto import encryption_enabled, decrypt_user_key, set_current_key
from database import get_db

STATIC_DIR = Path(__file__).resolve().parent / "static"


def _migrate_schema():
    """Add columns that exist in models but not yet in the DB (lightweight migration)."""
    import sqlalchemy
    insp = sqlalchemy.inspect(database.engine)
    if insp.has_table("users"):
        cols = {c["name"] for c in insp.get_columns("users")}
        with database.engine.begin() as conn:
            if "last_login" not in cols:
                conn.execute(sqlalchemy.text("ALTER TABLE users ADD COLUMN last_login DATETIME"))
            if "is_admin" not in cols:
                conn.execute(sqlalchemy.text("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"))
            if "last_notified_at" not in cols:
                conn.execute(sqlalchemy.text("ALTER TABLE users ADD COLUMN last_notified_at DATETIME"))
    for table in ("grants", "loans", "prices"):
        if insp.has_table(table):
            cols = {c["name"] for c in insp.get_columns(table)}
            if "version" not in cols:
                with database.engine.begin() as conn:
                    conn.execute(sqlalchemy.text(f"ALTER TABLE {table} ADD COLUMN version INTEGER NOT NULL DEFAULT 1"))
    with database.engine.begin() as conn:
        conn.execute(sqlalchemy.text("""
            CREATE TABLE IF NOT EXISTS sales (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                date DATE NOT NULL,
                shares INTEGER NOT NULL,
                price_per_share REAL NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                version INTEGER NOT NULL DEFAULT 1
            )
        """))
        conn.execute(sqlalchemy.text("""
            CREATE TABLE IF NOT EXISTS tax_settings (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                federal_income_rate REAL NOT NULL DEFAULT 0.37,
                federal_lt_cg_rate REAL NOT NULL DEFAULT 0.20,
                federal_st_cg_rate REAL NOT NULL DEFAULT 0.37,
                niit_rate REAL NOT NULL DEFAULT 0.038,
                state_income_rate REAL NOT NULL DEFAULT 0.0765,
                state_lt_cg_rate REAL NOT NULL DEFAULT 0.0536,
                state_st_cg_rate REAL NOT NULL DEFAULT 0.0765,
                lt_holding_days INTEGER NOT NULL DEFAULT 365
            )
        """))


@asynccontextmanager
async def lifespan(app):
    database.Base.metadata.create_all(bind=database.engine)
    _migrate_schema()
    task = _start_daily_scheduler()
    yield
    if task:
        task.cancel()


def _start_daily_scheduler():
    """Start background task that runs daily notification check at 7 AM."""
    import asyncio
    from datetime import datetime, time, timezone, timedelta

    vapid_key = os.getenv("VAPID_PRIVATE_KEY", "")
    smtp_host = os.getenv("SMTP_HOST", "")
    if not vapid_key and not smtp_host:
        return None

    async def _daily_loop():
        from notifications import send_daily_notifications, send_admin_daily_digest
        while True:
            now = datetime.now(timezone.utc)
            target = datetime.combine(now.date(), time(7, 0), tzinfo=timezone.utc)
            if now >= target:
                target += timedelta(days=1)
            await asyncio.sleep((target - now).total_seconds())
            try:
                send_daily_notifications()
            except Exception:
                pass
            try:
                send_admin_daily_digest()
            except Exception:
                pass

    return asyncio.ensure_future(_daily_loop())


class EncryptionMiddleware:
    """Pure ASGI middleware that sets per-user encryption key in contextvar.

    Runs in the event loop context so the contextvar propagates to
    sync endpoint functions running in threadpool workers.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and encryption_enabled():
            headers = dict(scope.get("headers", []))
            auth = headers.get(b"authorization", b"").decode()
            if auth.startswith("Bearer "):
                self._try_set_key(auth[7:])
        try:
            await self.app(scope, receive, send)
        finally:
            set_current_key(None)

    def _try_set_key(self, token: str):
        from auth import _decode_token
        from models import User
        try:
            payload = _decode_token(token)
            user_id = int(payload["sub"])
            db = database.SessionLocal()
            try:
                user = db.get(User, user_id)
                if user and user.encrypted_key:
                    set_current_key(decrypt_user_key(user.encrypted_key))
            finally:
                db.close()
        except Exception:
            pass


_fastapi_app = FastAPI(title="Equity Vesting Tracker", lifespan=lifespan)


def _is_admin_request(request: Request) -> bool:
    """Return True if the request carries a valid admin JWT."""
    try:
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            return False
        from auth import _decode_token, get_admin_emails
        payload = _decode_token(auth[7:])
        user_id = int(payload["sub"])
        db = database.SessionLocal()
        try:
            from models import User
            user = db.get(User, user_id)
            return bool(user and user.email.lower() in get_admin_emails())
        finally:
            db.close()
    except Exception:
        return False


@_fastapi_app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback as tb
    tb_str = tb.format_exc()
    logger.error("Unhandled error on %s %s: %s", request.method, request.url.path, exc, exc_info=True)

    # Persist to error_logs table (best-effort)
    try:
        from models import ErrorLog
        auth = request.headers.get("authorization", "")
        user_id = None
        if auth.startswith("Bearer "):
            try:
                from auth import _decode_token
                user_id = int(_decode_token(auth[7:])["sub"])
            except Exception:
                pass
        db = database.SessionLocal()
        try:
            db.add(ErrorLog(
                method=request.method,
                path=str(request.url.path),
                error_type=type(exc).__name__,
                error_message=str(exc) or type(exc).__name__,
                traceback=tb_str,
                user_id=user_id,
            ))
            db.commit()
        finally:
            db.close()
    except Exception:
        pass

    detail = (str(exc) or type(exc).__name__) if _is_admin_request(request) else "Internal server error"
    return JSONResponse(status_code=500, content={"detail": detail})


_fastapi_app.include_router(auth_router.router)
_fastapi_app.include_router(grants.router)
_fastapi_app.include_router(loans.router)
_fastapi_app.include_router(prices.router)
_fastapi_app.include_router(events.router)
_fastapi_app.include_router(flows.router)
_fastapi_app.include_router(import_export.router)
_fastapi_app.include_router(push.router)
_fastapi_app.include_router(admin.router)
_fastapi_app.include_router(notifications.router)
_fastapi_app.include_router(sales.router)
_fastapi_app.include_router(sales.tax_router)


@_fastapi_app.get("/api/health")
def health():
    return {"status": "ok"}


@_fastapi_app.get("/api/config")
def client_config():
    from auth import GOOGLE_CLIENT_ID
    from email_sender import email_configured
    privacy_url = os.environ.get("PRIVACY_URL", "")
    vapid_public_key = os.environ.get("VAPID_PUBLIC_KEY", "")
    return {
        "google_client_id": GOOGLE_CLIENT_ID,
        "privacy_url": privacy_url,
        "vapid_public_key": vapid_public_key,
        "email_notifications_available": email_configured(),
    }


@_fastapi_app.get("/api/me")
def current_user_info(user=Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "name": user.name, "is_admin": bool(user.is_admin)}


@_fastapi_app.post("/api/me/reset", status_code=204)
def reset_my_data(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete all financial data (grants, loans, prices) but keep the account."""
    from models import Grant, Loan, Price
    db.query(Grant).filter(Grant.user_id == user.id).delete()
    db.query(Loan).filter(Loan.user_id == user.id).delete()
    db.query(Price).filter(Price.user_id == user.id).delete()
    db.commit()


@_fastapi_app.delete("/api/me", status_code=204)
def delete_my_account(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Permanently delete account and all associated data."""
    from models import User, Grant, Loan, Price, PushSubscription, EmailPreference
    db.query(Grant).filter(Grant.user_id == user.id).delete()
    db.query(Loan).filter(Loan.user_id == user.id).delete()
    db.query(Price).filter(Price.user_id == user.id).delete()
    db.query(PushSubscription).filter(PushSubscription.user_id == user.id).delete()
    db.query(EmailPreference).filter(EmailPreference.user_id == user.id).delete()
    db.query(User).filter(User.id == user.id).delete()
    db.commit()


# Serve React build if the static directory exists (production)
if STATIC_DIR.is_dir():
    _fastapi_app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @_fastapi_app.get("/{path:path}")
    def spa_fallback(path: str):
        file = STATIC_DIR / path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")


# Wrap FastAPI app with encryption middleware
app = EncryptionMiddleware(_fastapi_app)
