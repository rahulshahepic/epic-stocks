"""Bounded public deploy metadata and hostname-scoped Cloudflare summaries."""
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from .diagnostics import MAX_BYTES, build, identity, utc

_cache = {}
_lock = threading.Lock()


def _json(method, url, **kwargs):
    # Fixed provider URLs only, no redirects and no arbitrary URLs from tool input.
    with httpx.stream(method, url, timeout=8, follow_redirects=False, **kwargs) as response:
        response.raise_for_status()
        raw = bytearray()
        for chunk in response.iter_bytes():
            raw.extend(chunk)
            if len(raw) > MAX_BYTES:
                raise ValueError("Diagnostic response too large")
        return json.loads(raw)


def _cached(key, source, action):
    # Cache failures too: a conversation must not hammer an unavailable provider.
    with _lock:
        now = time.monotonic()
        if key in _cache and now - _cache[key][0] < 120:
            return {**_cache[key][1], "checked_at_utc": identity()["checked_at_utc"], "cache_age_seconds": int(now - _cache[key][0])}
        result = {**identity(), "source": source, "state": "unavailable", "collected_at_utc": None}
        try:
            result.update(action())
            result.update(state="available", collected_at_utc=datetime.now(timezone.utc).isoformat())
        except (httpx.HTTPError, ImportError, ValueError, KeyError, TypeError, IndexError):
            # Provider errors can contain credentials, URLs and raw messages.
            pass
        if len(_cache) >= 8:
            _cache.clear()
        _cache[key] = (now, result)
        return result


def deployments():
    environment = identity()["environment"]
    branch = {"staging": "staging", "production": "main"}.get(environment)
    repo = os.getenv("DIAGNOSTICS_GITHUB_REPOSITORY", "")
    if branch is None or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo):
        return {**identity(), "source": "github_actions", "state": "unavailable", "collected_at_utc": None}

    def fetch():
        data = _json("GET", f"https://api.github.com/repos/{repo}/actions/workflows/deploy.yml/runs",
                     params={"branch": branch, "per_page": 20}, headers={"Accept": "application/vnd.github+json"})
        rows = data["workflow_runs"]
        if not isinstance(rows, list) or len(rows) > 20:
            raise ValueError("Invalid workflow response")
        records = []
        for row in rows:
            if row["head_branch"] != branch or row.get("event") not in {"push", "workflow_dispatch"}:
                continue
            status, conclusion = row["status"], row["conclusion"]
            if status not in {"queued", "in_progress", "completed", "waiting", "pending", "requested"}:
                raise ValueError("Invalid workflow status")
            if conclusion not in {None, "success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale", "startup_failure"}:
                raise ValueError("Invalid workflow conclusion")
            run_id = row["id"]
            if type(run_id) is not int or run_id < 1:
                raise ValueError("Invalid workflow id")
            records.append({"run_id": run_id, "commit": build(row["head_sha"]),
                            "status": status, "conclusion": conclusion,
                            "started_at_utc": utc(row.get("run_started_at") or row["created_at"]).isoformat(),
                            # Actions metadata exposes updated_at, not the deploy job's exact finish.
                            "last_updated_at_utc": utc(row["updated_at"]).isoformat(),
                            "url": f"https://github.com/{repo}/actions/runs/{run_id}"})
        running_build = identity()["api_build"]
        matched = next((r for r in records if r["commit"] == running_build and running_build and r["conclusion"] == "success"), None)
        return {"records": records, "branch": branch, "max_records": 20,
                "latest_failed_run": next((r for r in records if r["conclusion"] in {"failure", "timed_out", "startup_failure"}), None),
                "running_build_successful_run": matched,
                "coverage": "Latest 20 Deploy workflow runs for this branch; detailed job logs use the connected GitHub app",
                "record_limit_reached": data.get("total_count", len(rows)) > len(rows)}
    return _cached(("github", repo, branch, identity()["api_build"]), "github_actions", fetch)


_EDGE_QUERY = """query Diagnostics($zone: string!, $filter: FirewallEventsAdaptiveGroupsFilter_InputObject!) {
  viewer { zones(filter: {zoneTag: $zone}) {
    firewallEventsAdaptiveGroups(limit: 20, filter: $filter, orderBy: [count_DESC]) {
      count dimensions { action }
    }
  } }
}"""
_ACTIONS = {"allow", "block", "challenge", "jschallenge", "managed_challenge", "managedChallenge",
            "skip", "log", "bypass", "connectionClose", "connection_close", "forceConnectionClose"}


def edge_summary():
    zone, token, host = (os.getenv(key, "") for key in ("DIAGNOSTICS_CF_ZONE_ID", "DIAGNOSTICS_CF_API_TOKEN", "DOMAIN"))
    if not re.fullmatch(r"[a-f0-9]{32}", zone) or not token or not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", host):
        return {**identity(), "source": "cloudflare_waf", "state": "unavailable", "collected_at_utc": None}

    def fetch():
        end = datetime.now(timezone.utc) - timedelta(minutes=2)
        start = end - timedelta(minutes=30)
        data = _json("POST", "https://api.cloudflare.com/client/v4/graphql",
                     headers={"Authorization": f"Bearer {token}"},
                     json={"query": _EDGE_QUERY, "variables": {"zone": zone, "filter": {
                         "datetime_geq": start.isoformat(), "datetime_leq": end.isoformat(), "clientRequestHTTPHost": host}}})
        if data.get("errors"):
            raise ValueError("Cloudflare source unavailable")
        zones = data["data"]["viewer"]["zones"]
        if len(zones) != 1:
            raise ValueError("Cloudflare zone unavailable")
        rows = zones[0]["firewallEventsAdaptiveGroups"]
        if not isinstance(rows, list) or len(rows) > 20:
            raise ValueError("Invalid edge response")
        records = []
        for row in rows:
            action, count = row["dimensions"]["action"], row["count"]
            if action not in _ACTIONS or type(count) is not int or not 0 <= count <= 10**15:
                raise ValueError("Invalid edge summary")
            records.append({"action": action, "count": count})
        return {"window_start_utc": start.isoformat(), "window_end_utc": end.isoformat(),
                "records": records, "max_records": 20, "record_limit_reached": len(rows) == 20,
                "coverage": "Sampled WAF events for this exact hostname; excludes IPs, cookies, URLs and raw requests. Empty counts do not prove a healthy origin."}
    # Include credential identity without storing its value in a returned payload.
    import hashlib
    return _cached(("cloudflare", zone, host, identity()["environment"], hashlib.sha256(token.encode()).digest()), "cloudflare_waf", fetch)
