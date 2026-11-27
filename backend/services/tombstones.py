"""Restore-time deletion tombstones (#819, option 1).

When an account is deleted, the one deletion service records a minimal
marker — a hash of the IdP subject, no financial data, no plaintext
identifiers — in the backup settings handoff directory. That directory
is host-side and outside the pg_dump set, so a database restore cannot
lose the markers. After a restore, apply_tombstones re-deletes any
resurrected account through the same deletion service; it also runs from
the app startup bootstrap, so the check happens before the service opens.
Matching is by subject hash only: email is mutable, so an email match
could condemn a different live account that later holds the deleted
account's old address.
"""
import logging
from datetime import datetime, timezone

from services import tombstone_protocol as protocol

logger = logging.getLogger(__name__)


def _aware(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _retention_days():
    """Mirror the operator's backup retention: a tombstone only needs to
    outlive the backups that could resurrect its account."""
    try:
        from services import backup_admin
        observed, _ = backup_admin.snapshot()
        settings, _, _ = backup_admin.current_settings(observed)
        days = settings.get("retention_days")
        if type(days) is int and days >= 1:
            return days
    except Exception:
        pass
    return protocol.DEFAULT_RETENTION_DAYS


def _backups_running():
    """Pruning is only safe while backups verifiably run on schedule: the
    window + keep-newest arithmetic assumes the host prunes its archives
    the same way. When the host's status cannot be verified — diagnostics
    stale, backups overdue or stopped — entries are kept, not pruned, so
    a kept archive can never outlive its marker. The store's size cap
    still bounds growth and fails loudly long before it matters."""
    try:
        from services import backup_admin
        from services.backup_protocol import backup_state
        observed, _ = backup_admin.snapshot()
        return backup_state(observed, datetime.now(timezone.utc)) == "succeeded"
    except Exception:
        return False


def record_deletion(provider_name, subject, account_created_at, deleted_at=None):
    """Append one marker. Returns False when the host handoff is not
    installed (local development); raises when it is installed but the
    store cannot be read or written — a broken store must be repaired,
    never silently overwritten."""
    from services.backup_admin import locked, settings_dir, write_json
    if settings_dir() is None:
        return False
    entry = protocol.entry_for(provider_name, subject, account_created_at,
                               deleted_at or datetime.now(timezone.utc))
    with locked() as folder:
        path = folder / protocol.FILE_NAME
        entries = protocol.read_entries(path)
        entries = [e for e in entries if e["subject_hash"] != entry["subject_hash"]]
        entries.append(entry)
        if _backups_running():
            # The window never drops below the keep-newest count: the host
            # keeps that many backup runs (about that many days at a daily
            # cadence) even when the configured window is shorter.
            window = max(_retention_days(), protocol.KEEP_NEWEST)
            entries = protocol.prune_entries(entries, datetime.now(timezone.utc), window)
        write_json(path, {"version": protocol.VERSION, "entries": entries})
    return True


def apply_tombstones(db):
    """Re-delete restored accounts a tombstone names. Returns how many.

    A live account matches only when its subject hash matches an entry
    AND the account was created no later than the recorded deletion: an
    account the person re-registered after deleting is a new account
    and is never touched. Does not commit — the caller owns the
    transaction, like the deletion service itself.
    """
    from services.backup_admin import settings_dir
    folder = settings_dir()
    if folder is None:
        return 0
    entries = protocol.read_entries(folder / protocol.FILE_NAME)
    if not entries:
        return 0
    from scaffold.models import User
    from scaffold.user_deletion import delete_user
    removed = 0
    for user in db.query(User).all():
        if user.is_synthetic:
            continue
        subject = protocol.subject_hash(user.provider_name, user.google_id)
        created = _aware(user.created_at)
        for entry in entries:
            if subject != entry["subject_hash"]:
                continue
            deleted = protocol._timestamp(entry["deleted_at"])
            if deleted is not None and created <= deleted:
                delete_user(db, user.id)
                removed += 1
                break
    if removed:
        logger.warning("Re-deleted %d account(s) a backup restore had resurrected", removed)
    return removed
