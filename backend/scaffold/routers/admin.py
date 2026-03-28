import json
import logging
import os
import secrets
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from database import get_db
from scaffold.models import User, Grant, Loan, Price, PushSubscription, BlockedEmail, ErrorLog, EmailPreference, SystemMetric
from scaffold.auth import get_admin_user, get_admin_emails
from scaffold.maintenance import is_maintenance_active, set_maintenance
from scaffold.epic_mode import is_epic_mode, set_epic_mode

router = APIRouter(prefix="/api/admin", tags=["admin"])

# In-memory rate limiter for admin test-notify: 5 calls per hour per admin user.
# Acceptable to be per-instance only (admin-only cost-control valve).
_TEST_NOTIFY_LIMIT = 5
_test_notify_counts: dict[tuple, int] = defaultdict(int)  # (user_id, hour_utc) -> count

# Fixed advisory lock key for key rotation (PostgreSQL session-level lock).
_ROTATION_LOCK_KEY = 1234567890


class AdminStats(BaseModel):
    total_users: int
    active_users_30d: int
    total_grants: int
    total_loans: int
    total_prices: int
    db_size_bytes: int
    cpu_percent: float | None = None
    ram_used_mb: float | None = None
    ram_total_mb: float | None = None


class UserSummary(BaseModel):
    id: int
    email: str
    name: str | None
    is_admin: bool
    created_at: str
    last_login: str | None
    grant_count: int
    loan_count: int
    price_count: int


class BlockEmailRequest(BaseModel):
    email: str
    reason: str = ""


class BlockedEmailOut(BaseModel):
    id: int
    email: str
    reason: str | None
    blocked_at: str


@router.get("/stats", response_model=AdminStats)
def admin_stats(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    total_users = db.query(func.count(User.id)).scalar()
    active_users = db.query(func.count(User.id)).filter(User.last_login >= cutoff).scalar()
    total_grants = db.query(func.count(Grant.id)).scalar()
    total_loans = db.query(func.count(Loan.id)).scalar()
    total_prices = db.query(func.count(Price.id)).scalar()

    import database as _db_module
    if _db_module._is_sqlite:
        db_path = os.path.join(os.path.dirname(__file__), "..", "data", "vesting.db")
        try:
            db_size = os.path.getsize(db_path)
        except OSError:
            db_size = 0
    else:
        from sqlalchemy import text
        try:
            db_size = db.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0
        except Exception:
            db_size = 0

    latest = db.query(SystemMetric).order_by(SystemMetric.timestamp.desc()).first()

    return AdminStats(
        total_users=total_users,
        active_users_30d=active_users,
        total_grants=total_grants,
        total_loans=total_loans,
        total_prices=total_prices,
        db_size_bytes=db_size,
        cpu_percent=latest.cpu_percent if latest else None,
        ram_used_mb=latest.ram_used_mb if latest else None,
        ram_total_mb=latest.ram_total_mb if latest else None,
    )


@router.get("/cache-stats")
def admin_cache_stats(admin: User = Depends(get_admin_user)):
    from app.timeline_cache import get_stats
    from app import event_cache
    return {**get_stats(), "redis": event_cache.redis_info()}


class UserListResponse(BaseModel):
    users: list[UserSummary]
    total: int


@router.get("/users", response_model=UserListResponse)
def admin_users(
    q: str = "",
    limit: int = 10,
    offset: int = 0,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    admin_emails = get_admin_emails()
    query = db.query(User)
    if q:
        query = query.filter(User.email.ilike(f"%{q}%") | User.name.ilike(f"%{q}%"))
    total = query.count()
    # Sort by last_login descending, nulls last
    users = query.order_by(User.last_login.desc().nullslast()).offset(offset).limit(limit).all()
    result = []
    for u in users:
        gc = db.query(func.count(Grant.id)).filter(Grant.user_id == u.id).scalar()
        lc = db.query(func.count(Loan.id)).filter(Loan.user_id == u.id).scalar()
        pc = db.query(func.count(Price.id)).filter(Price.user_id == u.id).scalar()
        result.append(UserSummary(
            id=u.id, email=u.email, name=u.name,
            is_admin=u.email.lower() in admin_emails,
            created_at=u.created_at.isoformat() if u.created_at else "",
            last_login=u.last_login.isoformat() if u.last_login else None,
            grant_count=gc, loan_count=lc, price_count=pc,
        ))
    return UserListResponse(users=result, total=total)


@router.delete("/users/{user_id}", status_code=204)
def admin_delete_user(user_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    if is_maintenance_active():
        raise HTTPException(status_code=503, detail="Cannot delete users during maintenance")
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email.lower() in get_admin_emails():
        raise HTTPException(status_code=400, detail="Cannot delete an admin user")
    # Delete related records first to avoid loading encrypted columns with wrong key
    db.query(Grant).filter(Grant.user_id == user_id).delete()
    db.query(Loan).filter(Loan.user_id == user_id).delete()
    db.query(Price).filter(Price.user_id == user_id).delete()
    db.query(PushSubscription).filter(PushSubscription.user_id == user_id).delete()
    db.query(User).filter(User.id == user_id).delete()
    db.commit()


@router.get("/blocked", response_model=list[BlockedEmailOut])
def list_blocked(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    entries = db.query(BlockedEmail).order_by(BlockedEmail.blocked_at.desc()).all()
    return [BlockedEmailOut(
        id=e.id, email=e.email, reason=e.reason,
        blocked_at=e.blocked_at.isoformat() if e.blocked_at else "",
    ) for e in entries]


@router.post("/blocked", response_model=BlockedEmailOut, status_code=201)
def block_email(body: BlockEmailRequest, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email required")
    existing = db.query(BlockedEmail).filter(BlockedEmail.email == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already blocked")
    entry = BlockedEmail(email=email, reason=body.reason)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return BlockedEmailOut(
        id=entry.id, email=entry.email, reason=entry.reason,
        blocked_at=entry.blocked_at.isoformat() if entry.blocked_at else "",
    )


@router.delete("/blocked/{block_id}", status_code=204)
def unblock_email(block_id: int, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    entry = db.get(BlockedEmail, block_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Blocked entry not found")
    db.delete(entry)
    db.commit()


class ErrorLogOut(BaseModel):
    id: int
    timestamp: str
    method: str | None
    path: str | None
    error_type: str | None
    error_message: str | None
    traceback: str | None
    user_id: int | None


@router.get("/errors", response_model=list[ErrorLogOut])
def admin_errors(
    limit: int = 50,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    entries = db.query(ErrorLog).order_by(ErrorLog.timestamp.desc()).limit(limit).all()
    return [ErrorLogOut(
        id=e.id,
        timestamp=e.timestamp.isoformat() if e.timestamp else "",
        method=e.method,
        path=e.path,
        error_type=e.error_type,
        error_message=e.error_message,
        traceback=e.traceback,
        user_id=e.user_id,
    ) for e in entries]


@router.delete("/errors", status_code=204)
def clear_errors(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    db.query(ErrorLog).delete()
    db.commit()


class SystemMetricPoint(BaseModel):
    timestamp: str
    cpu_percent: float
    ram_used_mb: float
    ram_total_mb: float
    db_size_bytes: int
    error_log_count: int


@router.get("/metrics", response_model=list[SystemMetricPoint])
def admin_metrics(
    hours: int = 72,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 720)))
    rows = (
        db.query(SystemMetric)
        .filter(SystemMetric.timestamp >= cutoff)
        .order_by(SystemMetric.timestamp)
        .all()
    )
    return [
        SystemMetricPoint(
            timestamp=r.timestamp.isoformat(),
            cpu_percent=r.cpu_percent,
            ram_used_mb=r.ram_used_mb,
            ram_total_mb=r.ram_total_mb,
            db_size_bytes=r.db_size_bytes,
            error_log_count=r.error_log_count,
        )
        for r in rows
    ]


class DbTableInfo(BaseModel):
    table_name: str
    size_bytes: int
    row_estimate: int


@router.get("/db-tables", response_model=list[DbTableInfo])
def admin_db_tables(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    import database as _db_module
    if _db_module._is_sqlite:
        return []
    try:
        rows = db.execute(text("""
            SELECT
                t.tablename AS table_name,
                pg_total_relation_size(quote_ident(t.schemaname) || '.' || quote_ident(t.tablename)) AS size_bytes,
                COALESCE(s.n_live_tup, GREATEST(c.reltuples::bigint, 0)) AS row_estimate
            FROM pg_tables t
            LEFT JOIN pg_class c ON c.relname = t.tablename
                AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = t.schemaname)
            LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename
                AND s.schemaname = t.schemaname
            WHERE t.schemaname = 'public'
            ORDER BY size_bytes DESC
        """)).fetchall()
        return [
            DbTableInfo(table_name=r.table_name, size_bytes=r.size_bytes, row_estimate=r.row_estimate)
            for r in rows
        ]
    except Exception:
        return []


class TestNotifyRequest(BaseModel):
    user_id: int
    title: str
    body: str


class TestNotifyResult(BaseModel):
    push_sent: int
    push_failed: int
    email_sent: bool
    email_skipped_reason: str | None = None


@router.post("/test-notify", response_model=TestNotifyResult)
def admin_test_notify(
    body: TestNotifyRequest,
    admin: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
):
    hour_key = (admin.id, datetime.now(timezone.utc).strftime("%Y%m%d%H"))
    if _test_notify_counts[hour_key] >= _TEST_NOTIFY_LIMIT:
        raise HTTPException(status_code=429, detail=f"Rate limit: max {_TEST_NOTIFY_LIMIT} test notifications per hour")
    _test_notify_counts[hour_key] += 1

    user = db.query(User).filter(User.id == body.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    from scaffold.notifications import send_push
    payload = {"title": body.title, "body": body.body}
    subs = db.query(PushSubscription).filter(PushSubscription.user_id == user.id).all()
    push_sent = push_failed = 0
    for sub in subs:
        ok = send_push(sub, payload)
        if ok:
            push_sent += 1
        else:
            push_failed += 1
            db.delete(sub)
    if push_failed:
        db.commit()

    email_sent = False
    email_skipped_reason = None
    pref = db.query(EmailPreference).filter(EmailPreference.user_id == user.id).first()
    if not pref or not pref.enabled:
        email_skipped_reason = "user has email notifications disabled"
    else:
        from scaffold.email_sender import send_email, email_configured, app_url
        if not email_configured():
            import os
            missing = [k for k in ("RESEND_API_KEY", "RESEND_FROM") if not os.getenv(k)]
            email_skipped_reason = f"{' and '.join(missing)} not configured"
        else:
            try:
                url = app_url()
                link_html = f'<a href="{url}" style="color: #4472C4;">Open Equity Tracker</a>' if url else ""
                html_body = (
                    f'<div style="font-family: sans-serif; max-width: 480px;">'
                    f'<h2 style="color: #4472C4;">Equity Tracker</h2>'
                    f'<h3 style="margin-bottom: 4px;">{body.title}</h3>'
                    f'<p style="color: #374151;">{body.body}</p>'
                    + (f'<p>{link_html}</p>' if link_html else "")
                    + f'<p style="font-size: 12px; color: #9CA3AF;">This is a test notification.</p>'
                    f'</div>'
                )
                email_sent = send_email(
                    user.email,
                    body.title,
                    body.body,
                    html_body,
                )
                if not email_sent:
                    email_skipped_reason = "send failed (check server logs)"
            except Exception as exc:
                import traceback as tb
                logger.exception("Error sending test email to %s", user.email)
                db.add(ErrorLog(
                    method="POST",
                    path="/api/admin/test-notify",
                    error_type=type(exc).__name__,
                    error_message=str(exc),
                    traceback=tb.format_exc(),
                    user_id=admin.id,
                ))
                db.commit()
                email_skipped_reason = "send failed (check server logs)"

    return TestNotifyResult(push_sent=push_sent, push_failed=push_failed, email_sent=email_sent, email_skipped_reason=email_skipped_reason)


# ============================================================
# Maintenance mode
# ============================================================

class MaintenanceStatus(BaseModel):
    active: bool


class MaintenanceRequest(BaseModel):
    active: bool


@router.get("/maintenance", response_model=MaintenanceStatus)
def get_maintenance(admin: User = Depends(get_admin_user)):
    return MaintenanceStatus(active=is_maintenance_active())


@router.post("/maintenance", response_model=MaintenanceStatus)
def set_maintenance_endpoint(body: MaintenanceRequest, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    set_maintenance(db, body.active)
    return MaintenanceStatus(active=body.active)


class EpicModeStatus(BaseModel):
    active: bool


class EpicModeRequest(BaseModel):
    active: bool


@router.get("/epic-mode", response_model=EpicModeStatus)
def get_epic_mode(admin: User = Depends(get_admin_user)):
    return EpicModeStatus(active=is_epic_mode())


@router.post("/epic-mode", response_model=EpicModeStatus)
def set_epic_mode_endpoint(body: EpicModeRequest, admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    set_epic_mode(db, body.active)
    return EpicModeStatus(active=body.active)


# ============================================================
# Encryption key rotation
# ============================================================

def _get_snapshot(db) -> dict[int, str] | None:
    """Read the rotation snapshot from system_settings, or return None if absent."""
    row = db.execute(
        text("SELECT value FROM system_settings WHERE key = 'rotation_snapshot'")
    ).scalar()
    if row is None:
        return None
    return {int(k): v for k, v in json.loads(row).items()}


def _write_snapshot(db, snapshot: dict[int, str]) -> None:
    value = json.dumps({str(k): v for k, v in snapshot.items()})
    if db.execute(text("SELECT 1 FROM system_settings WHERE key = 'rotation_snapshot'")).scalar():
        db.execute(text("UPDATE system_settings SET value = :v WHERE key = 'rotation_snapshot'"), {"v": value})
    else:
        db.execute(text("INSERT INTO system_settings (key, value) VALUES ('rotation_snapshot', :v)"), {"v": value})
    db.commit()


def _delete_snapshot(db) -> None:
    db.execute(text("DELETE FROM system_settings WHERE key = 'rotation_snapshot'"))
    db.commit()


class RotationStatus(BaseModel):
    snapshot_exists: bool
    maintenance_active: bool


@router.get("/rotation-status", response_model=RotationStatus)
def get_rotation_status(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    """Return whether an interrupted rotation snapshot exists in the DB."""
    snapshot = _get_snapshot(db)
    return RotationStatus(
        snapshot_exists=snapshot is not None,
        maintenance_active=is_maintenance_active(),
    )


@router.post("/rotation-restore", status_code=200)
def rotation_restore(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    """Restore users.encrypted_key from the DB snapshot left by a crashed rotation.

    Safe to call when rotation completed successfully and the snapshot row is
    stale — the endpoint just returns 404 if no snapshot exists.
    """
    snapshot = _get_snapshot(db)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="No rotation snapshot found")

    for uid, enc_key in snapshot.items():
        db.execute(
            text("UPDATE users SET encrypted_key = :k WHERE id = :id"),
            {"k": enc_key, "id": uid},
        )
    db.commit()

    _delete_snapshot(db)
    set_maintenance(db, False)
    return {"restored": len(snapshot)}


@router.post("/rotate-key")
def rotate_key(admin: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    """Rotate the master encryption key.

    Generates a fresh master key, re-wraps every user's per-user key, runs a
    smoke test, and persists the new key to system_settings (encrypted by the
    KEY_ENCRYPTION_KEY).  All replicas pick up the new key automatically within
    crypto._RELOAD_TTL seconds — no restart or env-var update required.

    Streams SSE events so the admin can watch progress in real time.  On any
    failure the DB is rolled back and maintenance mode is cleared before the
    error event is emitted.
    """
    def event_stream():
        import scaffold.crypto as crypto_module
        import database as _db_module
        from scaffold.rotate_master_key import encrypt_user_key as _wrap, decrypt_user_key as _unwrap

        def sse(step: str, msg: str) -> str:
            return f"data: {json.dumps({'step': step, 'msg': msg})}\n\n"

        if not crypto_module.encryption_enabled():
            yield sse("error", "Encryption is not enabled (KEY_ENCRYPTION_KEY not set)")
            return
        old_master = crypto_module.ENCRYPTION_MASTER_KEY

        # Acquire PostgreSQL advisory lock to prevent concurrent rotations across replicas.
        # SQLite (test environment) skips this.
        lock_acquired = False
        if not _db_module._is_sqlite:
            try:
                lock_acquired = db.execute(
                    text("SELECT pg_try_advisory_lock(:k)"), {"k": _ROTATION_LOCK_KEY}
                ).scalar()
                if not lock_acquired:
                    yield sse("error", "Another rotation is already in progress on another instance")
                    return
            except Exception as exc:
                logger.warning("Advisory lock unavailable: %s", exc)

        # --- 1. Snapshot (persisted to DB so a crash doesn't lose old keys) ---
        rows = db.execute(
            text("SELECT id, encrypted_key FROM users WHERE encrypted_key IS NOT NULL")
        ).fetchall()
        snapshot: dict[int, str] = {r[0]: r[1] for r in rows}
        _write_snapshot(db, snapshot)
        yield sse("snapshot", f"Snapshotted {len(snapshot)} user key(s) to DB")

        new_master = secrets.token_hex(32)

        # --- 2. Enable maintenance (financial tables are encrypted; reads/writes
        #        would fail mid-rotation — users table is not encrypted so login
        #        still works during this window) ----------------------------
        set_maintenance(db, True)
        yield sse("maintenance", "Maintenance mode ON")

        error_msg: str | None = None
        try:
            # --- 3. Re-wrap all user keys ---------------------------------
            new_wrapped: dict[int, str] = {}
            for uid, enc_key in snapshot.items():
                raw = _unwrap(enc_key, old_master)
                new_wrapped[uid] = _wrap(raw, new_master)

            yield sse("rotating", f"Re-wrapped {len(new_wrapped)} user key(s)")

            # Write to DB
            for uid, new_enc in new_wrapped.items():
                db.execute(
                    text("UPDATE users SET encrypted_key = :k WHERE id = :id"),
                    {"k": new_enc, "id": uid},
                )
            db.commit()

            # --- 4. Smoke test -------------------------------------------
            for uid, new_enc in new_wrapped.items():
                _unwrap(new_enc, new_master)  # raises InvalidTag on failure

            yield sse("smoke", "All user keys verified")

            # --- 5. Persist new master key to system_settings -------------
            crypto_module.update_master_key(new_master, db)
            db.commit()
            yield sse("persist", "New key saved to DB — all replicas will reload automatically")

        except Exception as exc:
            error_msg = str(exc)
            yield sse("rollback", "Rolling back changes...")
            try:
                for uid, old_enc in snapshot.items():
                    db.execute(
                        text("UPDATE users SET encrypted_key = :k WHERE id = :id"),
                        {"k": old_enc, "id": uid},
                    )
                db.commit()
            except Exception:
                pass
        finally:
            set_maintenance(db, False)
            _delete_snapshot(db)
            # Release the advisory lock explicitly so it doesn't persist on the pooled connection
            if lock_acquired and not _db_module._is_sqlite:
                try:
                    db.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": _ROTATION_LOCK_KEY})
                    db.commit()
                except Exception:
                    pass

        if error_msg:
            yield sse("error", error_msg)
            # Notify all admins of the failure
            try:
                from scaffold.email_sender import send_email, email_configured, app_url
                from scaffold.auth import get_admin_emails
                if email_configured():
                    subject = "Key rotation failed — manual intervention may be required"
                    body = (
                        f"Key rotation failed with error:\n\n{error_msg}\n\n"
                        "The database was rolled back automatically. If the app is still in "
                        "maintenance mode, log in to the admin panel and restore from the "
                        f"snapshot or disable maintenance manually.\n\n{app_url()}/admin"
                    )
                    for email in get_admin_emails():
                        send_email(email, subject, body)
            except Exception:
                pass
        else:
            yield sse("done", "Rotation complete. New key is live on all replicas.")

    return StreamingResponse(event_stream(), media_type="text/event-stream")
