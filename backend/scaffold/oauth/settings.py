"""Which AI providers may connect, and whether any may at all.

This is policy, not deployment configuration, so it lives in the database and
is edited from the admin page. Turning ChatGPT off, or turning the whole
feature off after a report of something going wrong, should not need a redeploy
— and a rule the CLAUDE.md deployment section is explicit about is that fixing
production by hand is what leaves the repo out of sync with reality. An admin
toggle is the version of "just change it on the server" that survives the next
deploy.

Both reads sit on a one-second TTL cache, the same shape as scaffold/epic_mode.py,
so the authorize and token endpoints do not pay a query each.
"""
import json
import logging
import os
import time
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

ENABLED_KEY = "mcp_enabled"

# The redirect URIs a deployment allows out of the box, as
# (label, match, pattern). See models.OAuthRedirectHost for what each match
# means. To support another assistant, add its line here: the next boot seeds
# it once (seed_defaults), and an admin who later removes it keeps it removed.
# Prefer "exact"; use "prefix" only where the provider varies the tail of the
# path per connector, and "host" only where the path is unknown.
DEFAULT_REDIRECT_RULES: tuple[tuple[str, str, str], ...] = (
    ("Claude", "exact", "https://claude.ai/api/mcp/auth_callback"),
    ("Claude", "exact", "https://claude.com/api/mcp/auth_callback"),
    ("ChatGPT", "exact", "https://chatgpt.com/connector_platform_oauth_redirect"),
    ("ChatGPT", "prefix", "https://chatgpt.com/connector/oauth/"),
    ("Gemini", "prefix", "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-"),
    ("Grok", "exact", "https://grok.com/connectors-oauth-exchange-code/"),
    ("Grok", "exact", "https://grok.com/connectors/oauth/callback"),
    ("Muse", "exact", "https://agent.meta.ai/api/hatch/oauth/callback"),
    ("Muse", "exact", "https://muse.ai/api/hatch/oauth/callback"),
    ("Perplexity", "exact", "https://www.perplexity.ai/rest/connections/oauth_callback"),
    ("Perplexity", "exact", "https://enterprise.perplexity.ai/rest/connections/oauth_callback"),
    # Mistral has not published the callback path; allow the host.
    ("Mistral Le Chat", "host", "callback.mistral.ai"),
    ("Manus", "exact", "https://manus.im/api/webhook/mcp/callback"),
    # Locally run MCP clients (RFC 8252): any port, any path. Seeded disabled
    # on a real deployment (DOMAIN set): hosted assistants never use loopback,
    # and an attacker's "localhost" is the victim's own machine, so an admin
    # turns these on deliberately.
    ("Local clients", "loopback", "localhost"),
    ("Local clients", "loopback", "127.0.0.1"),
)

MATCH_TYPES = ("exact", "prefix", "host", "loopback")

# Which defaults have been seeded, so a rule an admin removes stays removed.
SEEDED_KEY = "oauth_default_redirects_seeded"

# How many refused redirect URIs to keep, and how much of each.
REJECTED_REDIRECT_CAP = 200
REJECTED_URI_MAX = 500

_CACHE_TTL = 1.0
_enabled_cache: tuple[bool, float] | None = None
_rules_cache: tuple[tuple[tuple[str, str], ...], float] | None = None


def invalidate() -> None:
    """Drop both caches. Called by every writer here."""
    global _enabled_cache, _rules_cache
    _enabled_cache = None
    _rules_cache = None


# ── the master switch ───────────────────────────────────────────────────────

def mcp_enabled() -> bool:
    """Whether AI connections are available on this deployment.

    Defaults to on when the row is missing, which is what a database that
    predates the setting looks like for the moment between migration and
    bootstrap. A missing row is not a decision to switch the feature off.
    """
    global _enabled_cache
    now = time.monotonic()
    if _enabled_cache is not None and now - _enabled_cache[1] < _CACHE_TTL:
        return _enabled_cache[0]

    active = True
    try:
        import database
        db = database.SessionLocal()
        try:
            row = db.execute(
                text("SELECT value FROM system_settings WHERE key = :k"),
                {"k": ENABLED_KEY},
            ).scalar()
            if row is not None:
                active = row == "true"
        finally:
            db.close()
    except Exception:
        # A blip must not silently turn the feature off (or on) — keep serving
        # whatever was last known, and only fall back to the default if there
        # is nothing to keep.
        if _enabled_cache is not None:
            return _enabled_cache[0]

    _enabled_cache = (active, now)
    return active


def set_mcp_enabled(db: Session, active: bool) -> None:
    """Write the switch and drop the cache. Commits the session it is given."""
    value = "true" if active else "false"
    updated = db.execute(
        text("UPDATE system_settings SET value = :v WHERE key = :k"),
        {"v": value, "k": ENABLED_KEY},
    ).rowcount
    if not updated:
        db.execute(
            text("INSERT INTO system_settings (key, value) VALUES (:k, :v)"),
            {"k": ENABLED_KEY, "v": value},
        )
    db.commit()
    invalidate()


# ── the redirect allowlist ──────────────────────────────────────────────────

def enabled_rules() -> tuple[tuple[str, str], ...]:
    """(match, pattern) for every rule currently switched on."""
    global _rules_cache
    now = time.monotonic()
    if _rules_cache is not None and now - _rules_cache[1] < _CACHE_TTL:
        return _rules_cache[0]

    try:
        import database
        db = database.SessionLocal()
        try:
            rows = db.execute(
                text("SELECT match_type, pattern FROM oauth_redirect_hosts WHERE enabled = 1")
            ).all()
        finally:
            db.close()
    except Exception:
        if _rules_cache is not None:
            return _rules_cache[0]
        # An empty allowlist refuses every registration, which is the safe
        # direction to fail: no connection is made, and the admin page says why.
        return ()

    rules = tuple(
        ((m or "host").strip().lower(), p.strip() if m in ("exact", "prefix") else p.strip().lower())
        for m, p in rows if p and p.strip()
    )
    _rules_cache = (rules, now)
    return rules


def _host_of(pattern: str) -> str:
    try:
        return (urlparse(pattern).hostname or "").lower()
    except ValueError:
        return ""


def _on_host(host: str, pattern: str) -> bool:
    return host == pattern or host.endswith("." + pattern)


def rule_matches(match: str, pattern: str, uri: str) -> bool:
    """Whether one rule admits this redirect URI. Never raises: refused URIs
    from anonymous registrations reach here unparsed and may be malformed."""
    try:
        return _rule_matches(match, pattern, uri)
    except ValueError:
        return False


def _rule_matches(match: str, pattern: str, uri: str) -> bool:
    parsed = urlparse(uri)
    _ = parsed.port  # raises on a malformed or out-of-range port
    host = (parsed.hostname or "").lower()
    if match == "exact":
        return uri == pattern
    if match == "prefix":
        expected = urlparse(pattern)
        # The host and port must be the pattern's own, so a prefix can never
        # stretch into another host ("https://a.com" + ".evil.com"), and a
        # dot segment cannot climb out of the allowed path.
        return (
            uri.startswith(pattern)
            and parsed.scheme == expected.scheme
            and host == (expected.hostname or "").lower()
            and parsed.port == expected.port
            and "/../" not in parsed.path + "/"
            and "%2e" not in parsed.path.lower()
        )
    if match == "host":
        return parsed.scheme == "https" and _on_host(host, pattern)
    if match == "loopback":
        return parsed.scheme in ("http", "https") and host == pattern
    return False


def uri_allowed(uri: str) -> bool:
    """Whether some enabled rule admits this redirect URI. Used at registration."""
    return any(rule_matches(m, p, uri) for m, p in enabled_rules())


def host_covered(host: str) -> bool:
    """Whether an enabled rule still covers this host.

    Checked at authorize and refresh for clients that already registered. It is
    the provider switch, not the URI check: turning a provider's rules off ends
    its connections, while a client registered under an older, broader rule
    keeps working until it does.
    """
    host = (host or "").strip().lower()
    if not host:
        return False
    for match, pattern in enabled_rules():
        if match in ("exact", "prefix") and host == _host_of(pattern):
            return True
        if match == "host" and _on_host(host, pattern):
            return True
        if match == "loopback" and host == pattern:
            return True
    return False


def has_any_rule() -> bool:
    return bool(enabled_rules())


def record_rejection(db: Session, uri: str, client_name: str | None, reason: str) -> None:
    """Remember a refused redirect URI for the admin page. Never raises."""
    from datetime import datetime, timezone
    from .models import OAuthRejectedRedirect

    clipped = (uri or "").strip()[:REJECTED_URI_MAX]
    if not clipped:
        return
    logger.warning("OAuth registration refused redirect_uri %r (client %r): %s",
                   clipped, (client_name or "")[:120], reason)
    try:
        now = datetime.now(timezone.utc)
        row = db.query(OAuthRejectedRedirect).filter(
            OAuthRejectedRedirect.redirect_uri == clipped
        ).first()
        if row is not None:
            row.attempts = (row.attempts or 0) + 1
            row.last_seen = now
            row.client_name = (client_name or row.client_name or "")[:120] or None
            row.reason = reason[:300]
        else:
            excess = db.query(OAuthRejectedRedirect).count() - REJECTED_REDIRECT_CAP + 1
            if excess > 0:
                oldest = db.query(OAuthRejectedRedirect.id).order_by(
                    OAuthRejectedRedirect.last_seen
                ).limit(excess).all()
                db.query(OAuthRejectedRedirect).filter(
                    OAuthRejectedRedirect.id.in_([r.id for r in oldest])
                ).delete(synchronize_session=False)
            db.add(OAuthRejectedRedirect(
                redirect_uri=clipped, client_name=(client_name or "")[:120] or None,
                reason=reason[:300], attempts=1, first_seen=now, last_seen=now,
            ))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Could not record a refused redirect_uri")


def seed_defaults(db: Session) -> None:
    """Put the switch and the default redirect rules in place.

    Runs on every boot and is deliberately additive: each default is seeded
    once, recorded under SEEDED_KEY, so a rule an admin deleted stays deleted
    and one they disabled stays disabled. A default added to
    DEFAULT_REDIRECT_RULES later is seeded on the next boot.
    """
    from .models import OAuthRedirectHost

    existing = db.execute(
        text("SELECT 1 FROM system_settings WHERE key = :k"), {"k": ENABLED_KEY}
    ).scalar()
    if existing is None:
        db.execute(
            text("INSERT INTO system_settings (key, value) VALUES (:k, 'true')"),
            {"k": ENABLED_KEY},
        )

    raw = db.execute(
        text("SELECT value FROM system_settings WHERE key = :k"), {"k": SEEDED_KEY}
    ).scalar()
    try:
        seeded = set(json.loads(raw)) if raw else set()
    except ValueError:
        seeded = set()

    present = {p for (p,) in db.query(OAuthRedirectHost.pattern).all()}
    changed = False
    for label, match, pattern in DEFAULT_REDIRECT_RULES:
        if pattern in seeded:
            continue
        if pattern not in present:
            off = match == "loopback" and bool(os.getenv("DOMAIN"))
            db.add(OAuthRedirectHost(label=label, match_type=match, pattern=pattern,
                                     enabled=0 if off else 1))
            present.add(pattern)
        seeded.add(pattern)
        changed = True

    if changed:
        value = json.dumps(sorted(seeded))
        if raw is None:
            db.execute(text("INSERT INTO system_settings (key, value) VALUES (:k, :v)"),
                       {"k": SEEDED_KEY, "v": value})
        else:
            db.execute(text("UPDATE system_settings SET value = :v WHERE key = :k"),
                       {"k": SEEDED_KEY, "v": value})

    db.commit()
    invalidate()
