"""Bounded, read-only site diagnostics for a separately consented site admin.

Exception messages, request paths and tracebacks may contain account data or
secrets. Keep them in the browser-only admin view; this connector exposes only
safe metadata and opaque references for correlation.
"""
import os
import re
from datetime import datetime, timedelta, timezone

from scaffold.models import ErrorLog, SystemMetric
from scaffold.oauth.scopes import ADMIN_READ
from scaffold.routers.admin import deployment_status

from .tools import Tool, ToolContext, object_schema, register


def _identity() -> dict:
    return {
        "environment": os.getenv("APP_ENV", "production"),
        "api_build": os.getenv("COMMIT_SHA") or None,
        "checked_at_utc": datetime.now(timezone.utc).isoformat(),
    }


def _integer(args: dict, name: str, default: int, low: int, high: int) -> int:
    value = args.get(name, default)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer from {low} to {high}")
    return value


def _deployment(ctx: ToolContext, args: dict) -> dict:
    status = deployment_status(admin=ctx.user, db=ctx.db)
    return {**_identity(), "scheduler": status.model_dump()}


def _metrics(ctx: ToolContext, args: dict) -> dict:
    hours = _integer(args, "hours", 24, 1, 168)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = (ctx.db.query(SystemMetric)
            .filter(SystemMetric.timestamp >= cutoff)
            .order_by(SystemMetric.timestamp.desc()).limit(97).all())
    return {
        **_identity(), "window_hours": hours, "max_samples": 96,
        "samples": [{
            "timestamp_utc": row.timestamp.isoformat(),
            "aggregated": bool(row.aggregated),
            "cpu_percent": row.cpu_percent,
            "ram_used_mb": row.ram_used_mb,
            "ram_total_mb": row.ram_total_mb,
            "db_size_bytes": row.db_size_bytes,
            "error_log_count": row.error_log_count,
            "cache_l1_hits": row.cache_l1_hits,
            "cache_l2_hits": row.cache_l2_hits,
            "cache_misses": row.cache_misses,
            "cache_l2_key_count": row.cache_l2_key_count,
        } for row in reversed(rows[:96])],
        "sample_limit_reached": len(rows) > 96,
    }


def _errors(ctx: ToolContext, args: dict) -> dict:
    limit = _integer(args, "limit", 20, 1, 50)
    rows = (ctx.db.query(ErrorLog).order_by(ErrorLog.timestamp.desc())
            .limit(limit + 1).all())
    return {
        **_identity(), "max_records": limit,
        "records": [{
            "id": row.id,
            "timestamp_utc": row.timestamp.isoformat() if row.timestamp else None,
            "method": row.method if row.method in {"GET", "POST", "PUT", "PATCH", "DELETE"} else None,
            "error_ref": row.error_ref if row.error_ref and re.fullmatch(r"[A-Za-z0-9_-]{1,32}", row.error_ref) else None,
            # The type is an exception class name, not its message or traceback.
            "error_type": row.error_type if row.error_type and row.error_type.isidentifier() else None,
        } for row in rows[:limit]],
        "record_limit_reached": len(rows) > limit,
        "detail_location": "Admin → Errors in this environment",
    }


_FRAME = re.compile(r'^\s*File "([^"]+\.py)", line (\d{1,7}), in ([A-Za-z_][A-Za-z_0-9]*)', re.MULTILINE)


def _error_stack(ctx: ToolContext, args: dict) -> dict:
    error_id = _integer(args, "error_id", 0, 1, 2_147_483_647)
    row = ctx.db.get(ErrorLog, error_id)
    if row is None:
        raise ValueError("No application error with that id in this environment")
    # Python's traceback source lines and exception text can contain SQL
    # parameters, tokens and personal information. Only validated frame
    # locations leave the server, never the original traceback string.
    frames = []
    for path, line, function in _FRAME.findall(row.traceback or "")[-12:]:
        filename = os.path.basename(path)
        if re.fullmatch(r"[A-Za-z_][A-Za-z_0-9.]*\.py", filename):
            frames.append({"file": filename, "line": int(line), "function": function})
    return {
        **_identity(), "error_id": error_id,
        "timestamp_utc": row.timestamp.isoformat() if row.timestamp else None,
        "error_type": row.error_type if row.error_type and row.error_type.isidentifier() else None,
        "frames": frames,
        "detail_location": "Admin → Errors in this environment",
    }


register(Tool(
    name="admin_deployment_status", title="Site deployment and scheduled jobs",
    description="Read the connected environment's API build, scheduler heartbeat, actual UTC job completion times and results. Does not inspect host logs or GitHub deployment runs.",
    input_schema=object_schema({}), scope=ADMIN_READ, handler=_deployment,
))
register(Tool(
    name="admin_system_metrics", title="Site system metrics",
    description="Read up to 96 recent CPU, RAM, database size, cache and error-count samples from the connected environment. Timestamps are UTC; older samples may be daily aggregates.",
    input_schema=object_schema({"hours": {"type": "integer", "minimum": 1, "maximum": 168, "default": 24}}),
    scope=ADMIN_READ, handler=_metrics,
))
register(Tool(
    name="admin_recent_errors", title="Recent application errors",
    description="Read up to 50 recent application exception records, with timestamp, method, type and opaque reference. Request paths, messages, stack traces and user data stay in the browser admin view. This is not a host log stream.",
    input_schema=object_schema({"limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20}}),
    scope=ADMIN_READ, handler=_errors,
))
register(Tool(
    name="admin_error_stack", title="Application error stack locations",
    description="Get up to 12 Python file names, line numbers and functions for one error id returned by admin_recent_errors. Excludes source lines, exception messages, request paths, local variables and SQL parameters; full traceback stays in Admin → Errors.",
    input_schema=object_schema({"error_id": {"type": "integer", "minimum": 1}}, ["error_id"]),
    scope=ADMIN_READ, handler=_error_stack,
))
