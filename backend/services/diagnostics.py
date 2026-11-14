"""Safe diagnostic envelopes. No arbitrary message, path or context leaves a source."""
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scaffold.models import SystemSettings

MAX_BYTES = 262_144
MAX_EVENTS = 96
RETENTION_HOURS = 72
HOST_STALE_SECONDS = 180
SCHEDULER_HISTORY_KEY = "diagnostics:scheduler:history"
CODES = {
    "container_running": ("container", "info"),
    "container_unhealthy": ("container", "error"),
    "container_stopped": ("container", "error"),
    "container_restarted": ("container", "warning"),
    "container_oom": ("container", "error"),
    "container_unavailable": ("container", "warning"),
    "scheduler_failed": ("scheduler", "error"),
    "scheduler_recovered": ("scheduler", "info"),
    "scheduler_succeeded": ("scheduler", "info"),
    "scheduler_unavailable": ("scheduler", "warning"),
    "collector_gap": ("host", "warning"),
    "disk_pressure": ("host", "warning"),
    "disk_recovered": ("host", "info"),
    **{f"{job}_{state}": ("scheduler", "error" if state == "failed" else "info")
       for job in ("maintenance", "notifications", "admin_digest", "runner")
       for state in ("failed", "recovered")},
}


def utc(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError("Invalid diagnostic timestamp")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Diagnostic timestamp must include timezone")
    return parsed.astimezone(timezone.utc)


def identity():
    return {"environment": os.getenv("APP_ENV", "production"),
            "api_build": build(os.getenv("COMMIT_SHA")),
            "checked_at_utc": datetime.now(timezone.utc).isoformat()}


def build(value):
    return value if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{7,40}", value) else None


def event(code, *, now=None, api_build=None, reference=None):
    component, severity = CODES[code]
    return {"timestamp_utc": (now or datetime.now(timezone.utc)).isoformat(),
            "environment": os.getenv("APP_ENV", "production"), "api_build": build(api_build),
            "component": component, "severity": severity, "event_code": code,
            "reference": reference if isinstance(reference, str) and re.fullmatch(r"[a-f0-9]{8,40}", reference) else None}


def safe_events(rows, environment, now):
    if not isinstance(rows, list) or len(rows) > MAX_EVENTS:
        raise ValueError("Invalid diagnostic history")
    output = []
    for row in rows:
        if not isinstance(row, dict) or row.get("event_code") not in CODES:
            raise ValueError("Invalid diagnostic event")
        stamp = utc(row.get("timestamp_utc"))
        if row.get("environment") != environment:
            raise ValueError("Diagnostic environment mismatch")
        if now - timedelta(hours=RETENTION_HOURS) <= stamp <= now + timedelta(seconds=30):
            clean = event(row["event_code"], now=stamp, api_build=row.get("api_build"), reference=row.get("reference"))
            clean["environment"] = environment
            output.append(clean)
    return sorted(output, key=lambda row: row["timestamp_utc"], reverse=True)


def host_snapshot(limit=20):
    now = datetime.now(timezone.utc)
    result = {**identity(), "source": "vps_collector", "state": "unavailable",
              "collected_at_utc": None, "records": [], "retention_hours": RETENTION_HOURS,
              "coverage": "Container state transitions, scheduler service result and disk pressure; not raw logs"}
    try:
        with Path(os.getenv("DIAGNOSTICS_HOST_FILE", "/run/epic-stocks-diagnostics/host.json")).open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("Diagnostic snapshot too large")
        data = json.loads(raw)
        if data["environment"] != result["environment"]:
            raise ValueError("Diagnostic environment mismatch")
        collected = utc(data["collected_at_utc"])
        age = (now - collected).total_seconds()
        if age < -30:
            raise ValueError("Diagnostic clock mismatch")
        records = safe_events(data["events"], result["environment"], now)
        states = data.get("states", {})
        if not isinstance(states, dict) or any(value not in CODES or CODES[value][0] != {"disk": "host"}.get(component, component)
                                              for component, value in states.items()):
            raise ValueError("Invalid collector state")
        result.update(state="stale" if age > HOST_STALE_SECONDS else "available",
                      collected_at_utc=collected.isoformat(), age_seconds=max(0, int(age)),
                      current_states=states, records=records[:limit], record_limit_reached=len(records) > limit,
                      history_started_at_utc=utc(data["history_started_at_utc"]).isoformat())
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return result


def record_scheduler(db, results, previous):
    now = datetime.now(timezone.utc)
    row = db.get(SystemSettings, SCHEDULER_HISTORY_KEY)
    try:
        rows = safe_events(json.loads(row.value), identity()["environment"], now) if row else []
    except (ValueError, TypeError):
        rows = []
    for job in set(results) | ({"runner"} if previous.get("runner") == "failed" else set()):
        status = results.get(job, "completed" if job == "runner" else "not_due")
        if job not in {"maintenance", "notifications", "admin_digest", "runner"}:
            continue
        state = "failed" if status == "failed" else "recovered" if status == "completed" and previous.get(job) == "failed" else None
        if state:
            rows.append(event(f"{job}_{state}", now=now, api_build=os.getenv("COMMIT_SHA")))
    value = json.dumps(sorted(rows, key=lambda r: r["timestamp_utc"])[-MAX_EVENTS:])
    if row is None:
        db.add(SystemSettings(key=SCHEDULER_HISTORY_KEY, value=value))
    else:
        row.value = value


def scheduler_history(db, limit=20):
    result = {**identity(), "source": "scheduled_jobs", "state": "unavailable",
              "records": [], "retention_hours": RETENTION_HOURS}
    row = db.get(SystemSettings, SCHEDULER_HISTORY_KEY)
    heartbeat = db.get(SystemSettings, "scheduled:runner:last_finished_at")
    if not row or not heartbeat:
        return result
    try:
        now = datetime.now(timezone.utc)
        age = (now - utc(heartbeat.value)).total_seconds()
        if age < -30:
            raise ValueError("Diagnostic clock mismatch")
        records = safe_events(json.loads(row.value), result["environment"], now)
        result.update(state="stale" if age > 2100 else "available", age_seconds=max(0, int(age)),
                      collected_at_utc=utc(heartbeat.value).isoformat(), records=records[:limit],
                      record_limit_reached=len(records) > limit)
    except (ValueError, TypeError):
        pass
    return result
