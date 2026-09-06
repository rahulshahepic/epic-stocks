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
import time

from sqlalchemy import text
from sqlalchemy.orm import Session

ENABLED_KEY = "mcp_enabled"

# What a deployment starts with: on, and the two products a user can actually
# connect from today. Seeded by migration for existing databases and by the
# lifespan bootstrap for fresh ones (the test suite builds its schema with
# create_all and never runs migrations, so it needs the second path).
DEFAULT_HOSTS: tuple[tuple[str, str], ...] = (
    ("ChatGPT", "chatgpt.com"),
    ("Claude", "claude.ai"),
    ("Claude", "claude.com"),
)

_CACHE_TTL = 1.0
_enabled_cache: tuple[bool, float] | None = None
_hosts_cache: tuple[frozenset[str], float] | None = None


def invalidate() -> None:
    """Drop both caches. Called by every writer here."""
    global _enabled_cache, _hosts_cache
    _enabled_cache = None
    _hosts_cache = None


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


# ── the provider allowlist ──────────────────────────────────────────────────

def allowed_redirect_hosts() -> frozenset[str]:
    """The hosts currently switched on."""
    global _hosts_cache
    now = time.monotonic()
    if _hosts_cache is not None and now - _hosts_cache[1] < _CACHE_TTL:
        return _hosts_cache[0]

    hosts: frozenset[str] = frozenset()
    try:
        import database
        db = database.SessionLocal()
        try:
            rows = db.execute(
                text("SELECT host FROM oauth_redirect_hosts WHERE enabled = 1")
            ).scalars().all()
            hosts = frozenset(h.strip().lower() for h in rows if h and h.strip())
        finally:
            db.close()
    except Exception:
        if _hosts_cache is not None:
            return _hosts_cache[0]
        # An empty allowlist refuses every registration, which is the safe
        # direction to fail: no connection is made, and the admin page says why.
        return frozenset()

    _hosts_cache = (hosts, now)
    return hosts


def host_allowed(host: str) -> bool:
    """Whether this host, or a subdomain of an allowed one, may be redirected to."""
    host = (host or "").strip().lower()
    if not host:
        return False
    return any(host == a or host.endswith("." + a) for a in allowed_redirect_hosts())


def seed_defaults(db: Session) -> None:
    """Put the switch and the default providers in place if they are not already.

    Runs on every boot and is deliberately additive: a host an admin deleted
    stays deleted, and one they disabled stays disabled. Only a genuinely
    absent row is created.
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

    # Seed the providers only into a table that has never had any. Re-adding a
    # host the admin removed on purpose would be the toggle undoing itself on
    # the next deploy.
    if db.query(OAuthRedirectHost).count() == 0:
        for label, host in DEFAULT_HOSTS:
            db.add(OAuthRedirectHost(label=label, host=host, enabled=1))

    db.commit()
    invalidate()
