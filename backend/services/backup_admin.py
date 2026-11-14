"""Admin's file handoff to the host job. Never reads or writes R2 credentials."""
import fcntl
import json
import os
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from services.backup_protocol import (EMPTY_SETTINGS, STAMP_RE, backup_state, destination_id, read_json,
                                      revision, safe_status, timestamp, validate_settings)


def environment():
    return os.getenv("APP_ENV", "production")


def settings_dir():
    value = os.getenv("BACKUP_SETTINGS_DIR")
    return Path(value) if value else None


def write_json(path, value):
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def locked():
    folder = settings_dir()
    if folder is None:
        raise OSError("Host backup controls are not installed")
    with (folder / ".lock").open("a") as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        yield folder


def snapshot():
    now = datetime.now(timezone.utc)
    try:
        data = read_json(Path(os.getenv("DIAGNOSTICS_HOST_FILE", "/run/epic-stocks-diagnostics/host.json")), 262144)
        collected = timestamp(data.get("collected_at_utc"))
        if data.get("environment") != environment() or not collected or not timedelta(seconds=-30) <= now - collected <= timedelta(minutes=3):
            return None, None
        return safe_status(data.get("backup"), environment()), collected.isoformat()
    except (OSError, ValueError):
        return None, None


def current_settings(observed):
    folder = settings_dir()
    if folder:
        try:
            value = validate_settings(read_json(folder / "settings.json"), environment())
            return value, revision(value), "admin"
        except FileNotFoundError:
            pass
    value = observed.get("settings") if observed else None
    return (value or {"version": 1, "environment": environment(), **EMPTY_SETTINGS}), None, "deployment"


def status():
    observed, collected = snapshot()
    invalid_settings = False
    try:
        settings, rev, source = current_settings(observed)
    except (OSError, ValueError):
        settings, rev, source = {"version": 1, "environment": environment(), **EMPTY_SETTINGS}, None, "admin"
        invalid_settings = True
    folder = settings_dir()
    state = backup_state(observed, datetime.now(timezone.utc))
    if invalid_settings:
        state = "invalid_settings"
    elif rev and observed and observed.get("settings_revision") != rev:
        state = "pending"
    restore = None
    if folder:
        try:
            record = read_json(folder / "restore-test.json")
            if (record.get("destination_id") == destination_id(settings)
                    and timestamp(record.get("tested_at_utc"))
                    and isinstance(record.get("run_id"), str)
                    and STAMP_RE.fullmatch(record["run_id"])):
                restore = {"tested_at_utc": record["tested_at_utc"], "run_id": record["run_id"], "source": "admin_recorded"}
        except (OSError, ValueError):
            pass
    return {"environment": environment(), "controls_available": folder is not None and folder.is_dir() and os.access(folder, os.W_OK),
            "settings": {k: settings[k] for k in EMPTY_SETTINGS}, "revision": rev, "settings_source": source,
            "state": state, "collected_at_utc": collected, "backup": observed, "restore_test": restore}


def save_settings(settings, expected_revision):
    document = validate_settings({"version": 1, "environment": environment(), **settings}, environment())
    with locked() as folder:
        observed, _ = snapshot()
        try:
            _, actual, _ = current_settings(observed)
        except (OSError, ValueError):
            # An invalid handoff must be explicitly repaired rather than silently overwritten.
            raise ValueError("Backup settings cannot be read; repair the host handoff first") from None
        if actual != expected_revision:
            raise FileExistsError("Backup settings changed. Refresh before saving again.")
        if actual != revision(document):
            write_json(folder / "settings.json", document)
    return status()


def request_run():
    with locked() as folder:
        current = status()
        if not current["settings"]["enabled"]:
            raise ValueError("Enable and save backup settings first")
        try:
            previous = timestamp(read_json(folder / "request.json").get("requested_at_utc"))
            if previous and datetime.now(timezone.utc) - previous < timedelta(minutes=1):
                raise FileExistsError("A backup was already requested. Wait a minute before trying again.")
        except FileNotFoundError:
            pass
        # Only a fixed request file is written. The host chooses the command and credentials.
        write_json(folder / "request.json", {"requested_at_utc": datetime.now(timezone.utc).isoformat()})
    return {"queued": True}


def record_restore(run_id):
    with locked() as folder:
        current = status()
        observed = current["backup"]
        if not observed or observed.get("last_success_run") != run_id:
            raise ValueError("Refresh and select the last successful backup")
        target = destination_id({"environment": environment(), **current["settings"]})
        if observed.get("backup_destination_id") != target:
            raise ValueError("The backup belongs to a different destination or encryption key")
        write_json(folder / "restore-test.json", {"run_id": run_id, "destination_id": target,
                                                  "tested_at_utc": datetime.now(timezone.utc).isoformat()})
    return status()
