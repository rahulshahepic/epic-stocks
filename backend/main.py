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
from scaffold.routers import auth_router, admin, notifications, push, sharing, unsubscribe
from app.routers import grants, loans, prices, events, flows, import_export, sales, horizon, cache as cache_router, tips, wizard
from scaffold.auth import get_current_user
from scaffold.crypto import encryption_enabled, decrypt_user_key, set_current_key
from database import get_db

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app):
    if database.engine.url.drivername.startswith("sqlite"):
        # Test environments use SQLite — skip Alembic, use create_all
        database.Base.metadata.create_all(bind=database.engine)
    else:
        # Production uses PostgreSQL — run Alembic migrations
        from pathlib import Path
        from alembic.config import Config
        from alembic import command as alembic_command
        cfg = Config(Path(__file__).parent / "alembic.ini")
        alembic_command.upgrade(cfg, "head")
        # One-time migration from SQLite if data/vesting.db exists and PG is empty
        from scaffold.migrate_sqlite_to_pg import maybe_migrate
        maybe_migrate()
    # Ensure system_settings seed rows exist and load/generate the master encryption key
    _bootstrap_system()
    redis_url = os.getenv("REDIS_URL", "")
    if redis_url:
        try:
            from app.event_cache import init as _redis_init
            _redis_init(redis_url)
        except Exception:
            logger.warning("Redis unavailable — running without L2 cache")
    task = _start_daily_scheduler()
    metrics_task = _start_metrics_sampler()
    maintenance_task = _start_nightly_maintenance()
    yield
    from app.event_cache import close as _redis_close
    _redis_close()
    if task:
        task.cancel()
    metrics_task.cancel()
    maintenance_task.cancel()


def _bootstrap_system():
    """Ensure system_settings seed rows and master key are initialized on every boot."""
    from scaffold.crypto import initialize_master_key
    db = database.SessionLocal()
    try:
        initialize_master_key(db)
    except Exception:
        logger.exception("Failed to bootstrap system settings")
    finally:
        db.close()


def _start_daily_scheduler():
    """Start background task that runs daily notification check at 7 AM."""
    import asyncio
    from datetime import datetime, time, timezone, timedelta

    vapid_key = os.getenv("VAPID_PRIVATE_KEY", "")
    smtp_host = os.getenv("SMTP_HOST", "")
    if not vapid_key and not smtp_host:
        return None

    async def _daily_loop():
        from scaffold.notifications import send_daily_notifications, send_admin_daily_digest
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


def _sample_metrics():
    """Take a single system metrics snapshot and persist it. Trims stale data."""
    import psutil
    from datetime import datetime, timezone, timedelta
    from sqlalchemy import func, text
    from scaffold.models import SystemMetric, ErrorLog

    db = database.SessionLocal()
    try:
        # Advisory lock: only one replica samples metrics at a time
        if not database._is_sqlite:
            acquired = db.execute(text("SELECT pg_try_advisory_lock(222222222)")).scalar()
            if not acquired:
                return

        cpu = psutil.cpu_percent(interval=0.5)
        mem = psutil.virtual_memory()

        if database._is_sqlite:
            db_path = os.path.join(os.path.dirname(__file__), "data", "vesting.db")
            try:
                db_size = os.path.getsize(db_path)
            except OSError:
                db_size = 0
        else:
            try:
                db_size = db.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0
            except Exception:
                db_size = 0

        error_count = db.query(func.count(ErrorLog.id)).scalar() or 0

        from app import timeline_cache, event_cache
        cs = timeline_cache.get_stats()
        ri = event_cache.redis_info()

        db.add(SystemMetric(
            cpu_percent=cpu,
            ram_used_mb=mem.used / (1024 * 1024),
            ram_total_mb=mem.total / (1024 * 1024),
            db_size_bytes=db_size,
            error_log_count=error_count,
            cache_l1_hits=cs["l1_hits"],
            cache_l2_hits=cs["l2_hits"],
            cache_misses=cs["misses"],
            cache_l2_key_count=ri.get("timeline_keys") if ri.get("connected") else None,
        ))

        # Purge raw (non-aggregated) rows older than 30 days.
        # Aggregated daily rows are managed separately by _aggregate_old_metrics().
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        db.query(SystemMetric).filter(
            SystemMetric.timestamp < cutoff,
            SystemMetric.aggregated == False,  # noqa: E712
        ).delete(synchronize_session=False)

        # Trim error_logs to the most recent 500 entries
        keep_ids = [
            row[0] for row in
            db.query(ErrorLog.id).order_by(ErrorLog.timestamp.desc()).limit(500).all()
        ]
        if keep_ids:
            db.query(ErrorLog).filter(ErrorLog.id.notin_(keep_ids)).delete(synchronize_session=False)
        else:
            db.query(ErrorLog).delete()

        db.commit()
    except Exception:
        pass
    finally:
        # Explicitly release the advisory lock so it doesn't persist on pooled connections
        if not database._is_sqlite:
            try:
                db.execute(text("SELECT pg_advisory_unlock(222222222)"))
                db.commit()
            except Exception:
                pass
        db.close()


def _aggregate_old_metrics():
    """Collapse raw metric rows older than 30 days into one aggregated row per UTC day.

    Each completed day in the 30-day → 1-year window is reduced to a single row
    (aggregated=True) holding daily averages/maxima.  Aggregated rows older than
    1 year are purged.  The function is idempotent: days that already have an
    aggregated row just have their remaining raw rows deleted.

    Cache hit/miss counters are stored as cumulative process-lifetime totals and
    have no meaningful per-day interpretation once the raw rows are gone, so they
    are left null on aggregated rows.
    """
    from datetime import datetime, time, timezone, timedelta, date as date_type
    from sqlalchemy import func, text
    from scaffold.models import SystemMetric

    db = database.SessionLocal()
    try:
        if not database._is_sqlite:
            acquired = db.execute(text("SELECT pg_try_advisory_lock(333333333)")).scalar()
            if not acquired:
                return

        now = datetime.now(timezone.utc)
        cutoff_raw = now - timedelta(days=30)
        cutoff_purge = now - timedelta(days=365)

        # Purge aggregated rows older than 1 year
        db.query(SystemMetric).filter(
            SystemMetric.timestamp < cutoff_purge,
            SystemMetric.aggregated == True,  # noqa: E712
        ).delete(synchronize_session=False)

        # Find distinct UTC days that still have raw rows in the 30-day→1-year window
        days_q = (
            db.query(func.date(SystemMetric.timestamp).label("day"))
            .filter(
                SystemMetric.timestamp < cutoff_raw,
                SystemMetric.timestamp >= cutoff_purge,
                SystemMetric.aggregated == False,  # noqa: E712
            )
            .group_by(func.date(SystemMetric.timestamp))
            .all()
        )

        for (day,) in days_q:
            day_date = date_type.fromisoformat(str(day))

            # If an aggregated row already exists for this day, just clean up stray raw rows
            already = db.query(SystemMetric).filter(
                SystemMetric.aggregated == True,  # noqa: E712
                func.date(SystemMetric.timestamp) == day,
            ).first()
            if already:
                db.query(SystemMetric).filter(
                    func.date(SystemMetric.timestamp) == day,
                    SystemMetric.aggregated == False,  # noqa: E712
                ).delete(synchronize_session=False)
                continue

            rows = db.query(SystemMetric).filter(
                func.date(SystemMetric.timestamp) == day,
                SystemMetric.aggregated == False,  # noqa: E712
            ).all()
            if not rows:
                continue

            n = len(rows)
            agg_ts = datetime.combine(day_date, time(12, 0), tzinfo=timezone.utc)
            db.add(SystemMetric(
                timestamp=agg_ts,
                aggregated=True,
                cpu_percent=sum(r.cpu_percent for r in rows) / n,
                ram_used_mb=sum(r.ram_used_mb for r in rows) / n,
                ram_total_mb=sum(r.ram_total_mb for r in rows) / n,
                db_size_bytes=max(r.db_size_bytes for r in rows),
                error_log_count=max(r.error_log_count for r in rows),
                # Cumulative cache counters are meaningless without the raw sequence
                cache_l1_hits=None,
                cache_l2_hits=None,
                cache_misses=None,
                cache_l2_key_count=None,
            ))
            db.flush()

            db.query(SystemMetric).filter(
                func.date(SystemMetric.timestamp) == day,
                SystemMetric.aggregated == False,  # noqa: E712
            ).delete(synchronize_session=False)

        db.commit()
    except Exception:
        logger.exception("Metric aggregation failed")
    finally:
        if not database._is_sqlite:
            try:
                db.execute(text("SELECT pg_advisory_unlock(333333333)"))
                db.commit()
            except Exception:
                pass
        db.close()


def _start_metrics_sampler():
    """Start background task that samples system metrics every 15 minutes."""
    import asyncio

    async def _loop():
        while True:
            _sample_metrics()
            await asyncio.sleep(15 * 60)

    return asyncio.ensure_future(_loop())


def _start_nightly_maintenance():
    """Start background task that runs metric aggregation at 03:00 UTC daily."""
    import asyncio
    from datetime import datetime, time, timezone, timedelta

    async def _loop():
        while True:
            now = datetime.now(timezone.utc)
            target = datetime.combine(now.date(), time(3, 0), tzinfo=timezone.utc)
            if now >= target:
                target += timedelta(days=1)
            await asyncio.sleep((target - now).total_seconds())
            _aggregate_old_metrics()
            try:
                db = database.SessionLocal()
                from app.routers.prices import _cleanup_epic_past_estimates
                _cleanup_epic_past_estimates(db)
            except Exception:
                logger.warning("Nightly estimate cleanup failed", exc_info=True)
            finally:
                db.close()

    return asyncio.ensure_future(_loop())


# API routes that are always accessible during maintenance (all HTTP methods).
_MAINT_ALLOWED_EXACT = frozenset({"/api/health", "/api/status", "/api/config", "/api/sharing/invite-info"})
_MAINT_ALLOWED_PREFIX = ("/api/auth/", "/api/admin/", "/api/push/", "/api/notifications/")
# GET /api/me is needed for nav (profile info, is_admin flag).
# Mutating methods on /api/me (DELETE = account deletion) must be blocked —
# account deletion cascades into encrypted financial tables.
_MAINT_ALLOWED_GET_EXACT = frozenset({"/api/me"})


class MaintenanceMiddleware:
    """Block financial API routes while maintenance mode is active in system_settings.

    Uses a 1-second TTL cache so the DB is queried at most once per second per
    replica.  Toggling maintenance from any replica propagates to all others
    within ~1 second automatically.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            from scaffold.maintenance import is_maintenance_active
            if is_maintenance_active():
                path = scope.get("path", "")
                if path.startswith("/api/"):
                    method = scope.get("method", "GET")
                    allowed = (
                        path in _MAINT_ALLOWED_EXACT
                        or path.startswith(_MAINT_ALLOWED_PREFIX)
                        or (path in _MAINT_ALLOWED_GET_EXACT and method == "GET")
                    )
                    if not allowed:
                        response = JSONResponse(
                            {"detail": "Service temporarily unavailable for maintenance"},
                            status_code=503,
                            headers={
                                "Cache-Control": "no-store, no-cache",
                                "CDN-Cache-Control": "no-store",
                                "Surrogate-Control": "no-store",
                            },
                        )
                        await response(scope, receive, send)
                        return
        await self.app(scope, receive, send)


# Write methods that are blocked on epic-mode fact tables.
_EPIC_WRITE_METHODS = frozenset({"POST", "PUT", "DELETE", "PATCH"})
# Prefixes whose writes are blocked in epic mode (data owned by Epic's systems).
_EPIC_BLOCKED_PREFIXES = ("/api/grants", "/api/prices", "/api/loans", "/api/import", "/api/wizard")
# Prefixes whose writes are always allowed (user-initiated actions).
_EPIC_ALLOWED_PREFIXES = (
    "/api/loans/",  # sub-resources like /execute-payoff are user actions
    "/api/internal/",
)


class EpicModeMiddleware:
    """Block writes to fact tables when epic_mode is active.

    Grants, prices, loans, and imports are owned by Epic's systems.
    Sales, loan payments, tax settings, and the cache-invalidation webhook
    remain writable regardless of epic mode.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            method = scope.get("method", "GET")
            if method in _EPIC_WRITE_METHODS:
                path = scope.get("path", "")
                if path.startswith(_EPIC_BLOCKED_PREFIXES):
                    # /api/loans/{id}/execute-payoff and /api/internal/* are user actions
                    if not path.startswith(_EPIC_ALLOWED_PREFIXES):
                        from scaffold.epic_mode import is_epic_mode
                        if is_epic_mode():
                            response = JSONResponse(
                                {"detail": "Data is managed externally in this deployment"},
                                status_code=403,
                            )
                            await response(scope, receive, send)
                            return
        await self.app(scope, receive, send)


class EncryptionMiddleware:
    """Pure ASGI middleware that sets per-user encryption key in contextvar.

    Also calls reload_master_key_if_stale() so key rotations performed on
    any replica propagate automatically within crypto._RELOAD_TTL seconds.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and encryption_enabled():
            headers = dict(scope.get("headers", []))
            cookie_header = headers.get(b"cookie", b"").decode()
            db = database.SessionLocal()
            try:
                from scaffold.crypto import reload_master_key_if_stale
                reload_master_key_if_stale(db)
                token = None
                for part in cookie_header.split(";"):
                    k, _, v = part.strip().partition("=")
                    if k == "session":
                        token = v
                        break
                if token:
                    self._try_set_key(token, db)
            finally:
                db.close()
        try:
            await self.app(scope, receive, send)
        finally:
            set_current_key(None)

    def _try_set_key(self, token: str, db=None):
        from scaffold.auth import _decode_token
        from scaffold.models import User
        try:
            payload = _decode_token(token)
            user_id = int(payload["sub"])
            own_db = db is None
            if own_db:
                db = database.SessionLocal()
            try:
                user = db.get(User, user_id)
                if user and user.encrypted_key:
                    set_current_key(decrypt_user_key(user.encrypted_key))
            finally:
                if own_db:
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
        from scaffold.auth import _decode_token, get_admin_emails
        payload = _decode_token(auth[7:])
        user_id = int(payload["sub"])
        db = database.SessionLocal()
        try:
            from scaffold.models import User
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
        from scaffold.models import ErrorLog
        auth = request.headers.get("authorization", "")
        user_id = None
        if auth.startswith("Bearer "):
            try:
                from scaffold.auth import _decode_token
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
_fastapi_app.include_router(loans.lp_router)
_fastapi_app.include_router(horizon.router)
_fastapi_app.include_router(cache_router.router)
_fastapi_app.include_router(tips.router)
_fastapi_app.include_router(wizard.router)
_fastapi_app.include_router(sharing.router)
_fastapi_app.include_router(unsubscribe.router)


@_fastapi_app.get("/api/health")
def health():
    return {"status": "ok"}


@_fastapi_app.get("/api/status")
def status():
    """Operational status for the frontend. Always 200; check 'maintenance' field."""
    from scaffold.maintenance import is_maintenance_active
    return {"maintenance": is_maintenance_active()}


@_fastapi_app.get("/api/config")
def client_config():
    from scaffold.email_sender import email_configured
    from scaffold.epic_mode import is_epic_mode
    return {
        "vapid_public_key": os.environ.get("VAPID_PUBLIC_KEY", ""),
        "email_notifications_available": email_configured(),
        "resend_from": os.environ.get("RESEND_FROM", ""),

        "epic_mode": is_epic_mode(),
    }


@_fastapi_app.get("/api/me")
def current_user_info(user=Depends(get_current_user), db: Session = Depends(get_db)):
    from scaffold.models import Invitation, User as _User
    shared = (
        db.query(Invitation)
        .filter(Invitation.invitee_id == user.id, Invitation.status == "accepted")
        .all()
    )
    shared_accounts = []
    for inv in shared:
        inviter = db.get(_User, inv.inviter_id)
        if inviter:
            shared_accounts.append({
                "invitation_id": inv.id,
                "inviter_name": inviter.name or inviter.email,
                "inviter_email": inviter.email,
            })
    return {
        "id": user.id, "email": user.email, "name": user.name,
        "is_admin": bool(user.is_admin),
        "shared_accounts": shared_accounts,
    }


@_fastapi_app.post("/api/me/reset", status_code=204)
def reset_my_data(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete all financial data (grants, loans, prices, sales, loan payments) but keep the account."""
    from scaffold.models import Grant, Loan, LoanPayment, Price, Sale
    db.query(LoanPayment).filter(LoanPayment.user_id == user.id).delete()
    db.query(Sale).filter(Sale.user_id == user.id).delete()
    db.query(Grant).filter(Grant.user_id == user.id).delete()
    db.query(Loan).filter(Loan.user_id == user.id).delete()
    db.query(Price).filter(Price.user_id == user.id).delete()
    db.commit()


@_fastapi_app.delete("/api/me", status_code=204)
def delete_my_account(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Permanently delete account and all associated data."""
    from scaffold.models import User, Grant, Loan, Price, PushSubscription, EmailPreference, Invitation
    db.query(Grant).filter(Grant.user_id == user.id).delete()
    db.query(Loan).filter(Loan.user_id == user.id).delete()
    db.query(Price).filter(Price.user_id == user.id).delete()
    db.query(PushSubscription).filter(PushSubscription.user_id == user.id).delete()
    db.query(EmailPreference).filter(EmailPreference.user_id == user.id).delete()
    # Sent invitations cascade-delete via FK; clear invitee_id on received ones
    db.query(Invitation).filter(Invitation.invitee_id == user.id).update(
        {Invitation.invitee_id: None, Invitation.status: "declined"}, synchronize_session=False
    )
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


# Wrap FastAPI app: maintenance check outermost, then epic-mode guard, then encryption
app = MaintenanceMiddleware(EpicModeMiddleware(EncryptionMiddleware(_fastapi_app)))
