"""Deletion-tombstone file contract: what the app writes and a restore reads.

Stdlib-only, like services/backup_protocol.py. The file lives in the backup
settings handoff directory — host-side, outside the pg_dump set — so a whole
database restore cannot lose it. This module is the fixed validator for it:
an exact key set, hashed identifiers only, bounded size. Nothing here may
grow a path, a command or a plaintext identifier.

An entry records that an account was deleted, so a restore that resurrects
the account can re-delete it. It carries no financial data: one SHA-256
hash (of the IdP subject — the stable sign-in identifier), the account's
creation time and the deletion time. The email is deliberately NOT
recorded: it is mutable (sign-in rewrites it from the IdP profile), so an
email match could condemn a different live account that later holds the
deleted account's old address. The creation time is the guard that keeps
a person who re-registers after deleting from ever matching their own
tombstone.
"""
import hashlib
import json
import os
import re
import stat
from datetime import datetime, timezone

FILE_NAME = "deleted-accounts.json"
VERSION = 1
MAX_BYTES = 262144
KEEP_NEWEST = 7
DEFAULT_RETENTION_DAYS = 30
_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
_ENTRY_KEYS = {"subject_hash", "account_created_at", "deleted_at"}


def subject_hash(provider_name, subject):
    return hashlib.sha256(f"{provider_name}\0{subject}".encode()).hexdigest()


def _timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def validate_document(value):
    """Return the entry list, or raise ValueError. Exact shape, nothing extra."""
    if not isinstance(value, dict) or set(value) != {"version", "entries"}:
        raise ValueError("Invalid tombstone document")
    if type(value["version"]) is not int or value["version"] != VERSION:
        raise ValueError("Invalid tombstone version")
    if not isinstance(value["entries"], list):
        raise ValueError("Invalid tombstone entries")
    entries = []
    for entry in value["entries"]:
        if not isinstance(entry, dict) or set(entry) != _ENTRY_KEYS:
            raise ValueError("Invalid tombstone entry")
        if not isinstance(entry["subject_hash"], str) or not _HASH_RE.fullmatch(entry["subject_hash"]):
            raise ValueError("Invalid tombstone identifier hash")
        for key in ("account_created_at", "deleted_at"):
            if _timestamp(entry[key]) is None:
                raise ValueError("Invalid tombstone timestamp")
        entries.append({key: entry[key] for key in sorted(_ENTRY_KEYS)})
    return entries


def read_entries(path):
    """Read and validate the tombstone file. Missing file means no entries."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return []
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Tombstone store must be a regular file")
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Tombstone store is too large")
    try:
        value = json.loads(raw)
    except (ValueError, RecursionError):
        raise ValueError("Tombstone store is not valid JSON") from None
    return validate_document(value)


def entry_for(provider_name, subject, account_created_at, deleted_at):
    def iso(value):
        # A raw-SQL read on SQLite hands back the stored string, not a
        # datetime; both mean UTC here.
        if isinstance(value, str):
            value = datetime.fromisoformat(value)
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()
    return {
        "subject_hash": subject_hash(provider_name, subject),
        "account_created_at": iso(account_created_at),
        "deleted_at": iso(deleted_at),
    }


def prune_entries(entries, now, retention_days):
    """Keep an entry exactly as long as a backup could resurrect its account:
    the retention window, plus the newest KEEP_NEWEST entries regardless of
    age — the same window + keep-newest floor the backups themselves use."""
    ordered = sorted(entries, key=lambda e: e["deleted_at"], reverse=True)
    kept = []
    for index, entry in enumerate(ordered):
        deleted = _timestamp(entry["deleted_at"])
        age_days = (now - deleted).total_seconds() / 86400 if deleted else 0
        if index < KEEP_NEWEST or age_days <= retention_days:
            kept.append(entry)
    return list(reversed(kept))
