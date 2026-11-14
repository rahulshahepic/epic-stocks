"""Non-secret file contract shared by Admin and the independent host backup job.

This module is stdlib-only; the deploy installs it alongside the host scripts.
"""
import hashlib
import json
import os
import re
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path

CONFIG_DIR = Path("/var/lib/epic-stocks-backup-config")
SETTINGS_KEYS = {"enabled", "account_id", "bucket", "recipient", "retention_days"}
STAMP_RE = re.compile(r"^\d{8}T\d{6}Z$")
EMPTY_SETTINGS = {"enabled": False, "account_id": "", "bucket": "", "recipient": "", "retention_days": 30}


def read_json(path, limit=8192):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("Backup metadata must be a regular file")
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("Backup metadata is too large")
    try:
        value = json.loads(raw)
    except RecursionError:
        raise ValueError("Backup metadata is too deeply nested") from None
    if not isinstance(value, dict):
        raise ValueError("Invalid backup metadata")
    return value


def validate_settings(value, environment):
    if (not isinstance(value, dict) or type(value.get("version")) is not int or value.get("version") != 1
            or value.get("environment") != environment
            or set(value) != SETTINGS_KEYS | {"version", "environment"}):
        raise ValueError("Invalid backup settings or environment")
    if type(value["enabled"]) is not bool or type(value["retention_days"]) is not int:
        raise ValueError("Invalid backup enable or retention setting")
    if not 1 <= value["retention_days"] <= 3650:
        raise ValueError("Retention must be between 1 and 3650 days")
    rules = {"account_id": r"[a-f0-9]{32}", "bucket": r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]",
             "recipient": r"age1[0-9a-z]{58}"}
    for key, pattern in rules.items():
        field = value[key]
        if not isinstance(field, str) or (field and not re.fullmatch(pattern, field)):
            raise ValueError(f"Invalid backup {key}")
        if value["enabled"] and not field:
            raise ValueError("Account ID, bucket and public encryption key are required to enable backups")
    if ".." in value["bucket"] or ".-" in value["bucket"] or "-." in value["bucket"]:
        raise ValueError("Invalid backup bucket")
    return {key: value[key] for key in ("version", "environment", *sorted(SETTINGS_KEYS))}


def revision(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def destination_id(settings):
    return revision({key: settings.get(key, "") for key in ("environment", "account_id", "bucket", "recipient")})


def timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except ValueError:
        return None


def error_summary(value):
    """Do not forward arbitrary process, storage or status-file text to a browser."""
    if not isinstance(value, str):
        return None
    safe_messages = {"Encryption failed. Check the backup service journal.",
                     "The database dump failed. Check the backup service journal.",
                     "Backup settings are invalid. Check the destination and public encryption key.",
                     "The host backup job reported an error. Check its service journal."}
    if value in safe_messages or re.fullmatch(r"Backup storage returned HTTP [1-5]\d\d\.", value):
        return value
    match = re.fullmatch(r"(?:PUT|HEAD|GET|DELETE) failed: HTTP ([1-5]\d\d)(?: [A-Za-z]{1,64})?", value)
    if match:
        return f"Backup storage returned HTTP {match[1]}."
    if value.startswith("age "):
        return "Encryption failed. Check the backup service journal."
    if value.startswith("pg_dump "):
        return "The database dump failed. Check the backup service journal."
    if "recipient" in value or "RETENTION" in value or value == "Invalid backup settings":
        return "Backup settings are invalid. Check the destination and public encryption key."
    return "The host backup job reported an error. Check its service journal."


def safe_status(value, environment):
    if not isinstance(value, dict) or value.get("environment") != environment:
        return None
    result = {"environment": environment}
    for key in ("configured", "credentials_configured", "enabled"):
        result[key] = value.get(key) if type(value.get(key)) is bool else None
    for key in ("last_attempt_utc", "last_success_utc"):
        parsed = timestamp(value.get(key))
        result[key] = parsed.isoformat() if parsed else None
    allowed = {"success", "failed", "running", "unconfigured", "disabled"}
    result["last_result"] = value.get("last_result") if isinstance(value.get("last_result"), str) and value["last_result"] in allowed else None
    for key in ("database_plaintext_bytes", "database_encrypted_bytes", "secrets_encrypted_bytes", "pruned_runs"):
        number = value.get(key)
        result[key] = number if type(number) is int and 0 <= number <= 10**15 else None
    for key in ("duration_seconds", "last_success_duration_seconds"):
        number = value.get(key)
        result[key] = number if type(number) in (int, float) and 0 <= number <= 86400 else None
    for key in ("settings_revision", "backup_destination_id"):
        text = value.get(key)
        result[key] = text if isinstance(text, str) and re.fullmatch(r"[a-f0-9]{64}", text) else None
    for key in ("last_run", "last_success_run"):
        text = value.get(key)
        result[key] = text if isinstance(text, str) and STAMP_RE.fullmatch(text) else None
    result["error"] = error_summary(value.get("error"))
    result["prune_error"] = error_summary(value.get("prune_error"))
    try:
        result["settings"] = validate_settings(value.get("settings"), environment)
    except ValueError:
        result["settings"] = None
    return result


def backup_state(value, now):
    if not value:
        return "unavailable"
    if value.get("last_result") == "disabled":
        return "disabled"
    if value.get("configured") is False:
        return "unconfigured"
    if value.get("last_result") == "running":
        start = timestamp(value.get("last_attempt_utc"))
        return "running" if start and timedelta(minutes=-5) <= now - start <= timedelta(minutes=70) else "failed"
    if value.get("last_result") == "failed":
        return "failed"
    last = timestamp(value.get("last_success_utc"))
    if not last:
        return "unavailable"
    return "succeeded" if timedelta(minutes=-5) <= now - last <= timedelta(hours=26) else "overdue"
