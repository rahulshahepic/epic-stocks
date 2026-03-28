"""Per-user column-level encryption using AES-256-GCM.

Key hierarchy
-------------
  KEY_ENCRYPTION_KEY (env var, never rotates)
      └── master_key (stored encrypted in system_settings, rotatable)
              └── user.encrypted_key (per-user 256-bit key, stored encrypted by master_key)
                      └── field data (encrypted by user key via EncryptedFloat / EncryptedInt / EncryptedString)

When KEY_ENCRYPTION_KEY is set:
  - On first boot the lifespan calls initialize_master_key() to load (or generate) the
    master key from system_settings.
  - Each user gets a random 256-bit data key (stored in users.encrypted_key, encrypted by
    master key).
  - Sensitive fields are encrypted before INSERT, decrypted after SELECT.
  - Encrypted values are prefixed with "$ENC$" to distinguish from plaintext.
  - EncryptionMiddleware calls reload_master_key_if_stale() on every request so key
    rotations performed on any replica propagate automatically within _RELOAD_TTL seconds.

When KEY_ENCRYPTION_KEY is not set:
  - No encryption; values pass through as strings.
  - Existing plaintext data remains readable.

Migration from single-level setup
----------------------------------
  Set LEGACY_MASTER_KEY to the old ENCRYPTION_MASTER_KEY value.  On first boot,
  initialize_master_key() stores it as the master key (encrypted by the KEK) so
  existing user-key wrapping is preserved without re-wrapping anything.
  LEGACY_MASTER_KEY can be removed after the first successful boot.
"""

import base64
import hashlib
import os
import secrets
import time
from contextvars import ContextVar

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

# ── Key-encryption key (KEK) ──────────────────────────────────────────────────
# Set once in the environment, never changes in normal operations.
_KEK: str = os.getenv("KEY_ENCRYPTION_KEY", "")

# ── Operational master key ────────────────────────────────────────────────────
# Loaded from system_settings on startup; updated in-memory when rotated.
ENCRYPTION_MASTER_KEY: str = ""

# Stale-key detection: track the DB version and when we last checked.
_master_key_version: int = -1   # -1 = not yet loaded
_master_key_last_checked: float = 0.0
_RELOAD_TTL: float = 5.0        # seconds between DB version checks

_current_key: ContextVar[bytes | None] = ContextVar("_current_key", default=None)
_ENC_PREFIX = "$ENC$"


# ── Public interface ──────────────────────────────────────────────────────────

def encryption_enabled() -> bool:
    return bool(_KEK)


def reload_master_key_if_stale(db) -> None:
    """Check the DB for a new master_key_version; reload if changed or on first call.

    Called from EncryptionMiddleware on every request.  The TTL cache limits the
    actual DB query to once per _RELOAD_TTL seconds per replica, regardless of
    request rate.
    """
    global ENCRYPTION_MASTER_KEY, _master_key_version, _master_key_last_checked
    if not _KEK:
        return
    now = time.monotonic()
    if now - _master_key_last_checked < _RELOAD_TTL:
        return
    _master_key_last_checked = now
    try:
        from sqlalchemy import text
        version_str = db.execute(
            text("SELECT value FROM system_settings WHERE key = 'master_key_version'")
        ).scalar()
        if version_str is None:
            return
        db_version = int(version_str)
        if db_version == _master_key_version:
            return
        # Version changed — reload the master key
        key_blob = db.execute(
            text("SELECT value FROM system_settings WHERE key = 'master_key'")
        ).scalar()
        if key_blob:
            ENCRYPTION_MASTER_KEY = _decrypt_with_kek(key_blob)
            _master_key_version = db_version
    except Exception:
        pass


def initialize_master_key(db) -> None:
    """Load (or generate) the master key from system_settings.  Called from lifespan.

    Also ensures the seed rows (maintenance_active, master_key_version) exist so
    test environments that use create_all instead of Alembic work correctly.
    """
    global ENCRYPTION_MASTER_KEY, _master_key_version, _master_key_last_checked
    from sqlalchemy import text

    # Ensure seed rows exist (Alembic inserts them in production; create_all does not)
    for key, default in [("maintenance_active", "false"), ("master_key_version", "1"), ("epic_mode", "false")]:
        if not db.execute(text("SELECT 1 FROM system_settings WHERE key = :k"), {"k": key}).scalar():
            db.execute(
                text("INSERT INTO system_settings (key, value) VALUES (:k, :v)"),
                {"k": key, "v": default},
            )

    if not _KEK:
        db.commit()
        return  # encryption disabled

    existing = db.execute(
        text("SELECT value FROM system_settings WHERE key = 'master_key'")
    ).scalar()

    if existing:
        ENCRYPTION_MASTER_KEY = _decrypt_with_kek(existing)
        version_str = db.execute(
            text("SELECT value FROM system_settings WHERE key = 'master_key_version'")
        ).scalar() or "1"
        _master_key_version = int(version_str)
        _master_key_last_checked = time.monotonic()
        db.commit()
        return

    # First boot: use LEGACY_MASTER_KEY if set (migration path), else generate fresh key
    legacy = os.getenv("LEGACY_MASTER_KEY", "")
    master_key = legacy if legacy else secrets.token_hex(32)

    db.execute(
        text("INSERT INTO system_settings (key, value) VALUES ('master_key', :v)"),
        {"v": _encrypt_with_kek(master_key)},
    )
    db.execute(
        text("UPDATE system_settings SET value = '1' WHERE key = 'master_key_version'")
    )
    db.commit()

    ENCRYPTION_MASTER_KEY = master_key
    _master_key_version = 1
    _master_key_last_checked = time.monotonic()


def update_master_key(new_key: str, db) -> None:
    """Persist a new master key to system_settings and update the in-memory global.

    Called by the key-rotation admin endpoint after successfully re-wrapping all
    user keys.  Increments master_key_version so other replicas detect the change
    and reload within _RELOAD_TTL seconds.  The caller is responsible for committing
    the surrounding transaction.
    """
    global ENCRYPTION_MASTER_KEY, _master_key_version, _master_key_last_checked
    from sqlalchemy import text

    new_version = max(_master_key_version + 1, 1)
    db.execute(
        text("UPDATE system_settings SET value = :v WHERE key = 'master_key'"),
        {"v": _encrypt_with_kek(new_key)},
    )
    db.execute(
        text("UPDATE system_settings SET value = :v WHERE key = 'master_key_version'"),
        {"v": str(new_version)},
    )
    # Caller commits; update in-memory state so this instance uses the new key immediately
    ENCRYPTION_MASTER_KEY = new_key
    _master_key_version = new_version
    _master_key_last_checked = time.monotonic()


# ── Per-user key operations ───────────────────────────────────────────────────

def generate_user_key() -> bytes:
    return AESGCM.generate_key(bit_length=256)


def encrypt_user_key(raw_key: bytes) -> str:
    nonce = os.urandom(12)
    ct = _master_aesgcm().encrypt(nonce, raw_key, None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_user_key(encrypted: str) -> bytes:
    data = base64.b64decode(encrypted)
    return _master_aesgcm().decrypt(data[:12], data[12:], None)


def set_current_key(key: bytes | None):
    _current_key.set(key)


def get_current_key() -> bytes | None:
    return _current_key.get()


# ── Field-level encryption ────────────────────────────────────────────────────

def encrypt_value(plaintext: str, key: bytes) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return _ENC_PREFIX + base64.b64encode(nonce + ct).decode()


def decrypt_value(ciphertext: str, key: bytes) -> str:
    data = base64.b64decode(ciphertext[len(_ENC_PREFIX):])
    return AESGCM(key).decrypt(data[:12], data[12:], None).decode()


# ── Internal helpers ──────────────────────────────────────────────────────────

def _kek_aesgcm() -> AESGCM:
    key = hashlib.sha256(_KEK.encode()).digest()
    return AESGCM(key)


def _master_aesgcm() -> AESGCM:
    key = hashlib.sha256(ENCRYPTION_MASTER_KEY.encode()).digest()
    return AESGCM(key)


def _encrypt_with_kek(plaintext: str) -> str:
    nonce = os.urandom(12)
    ct = _kek_aesgcm().encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def _decrypt_with_kek(ciphertext: str) -> str:
    data = base64.b64decode(ciphertext)
    return _kek_aesgcm().decrypt(data[:12], data[12:], None).decode()


# ── SQLAlchemy TypeDecorators ─────────────────────────────────────────────────

class EncryptedFloat(TypeDecorator):
    """Float stored encrypted at rest. Transparent to application code."""
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        key = get_current_key()
        if key:
            return encrypt_value(str(value), key)
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        key = get_current_key()
        if key and value.startswith(_ENC_PREFIX):
            return float(decrypt_value(value, key))
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0


class EncryptedInt(TypeDecorator):
    """Integer stored encrypted at rest. Transparent to application code."""
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        key = get_current_key()
        if key:
            return encrypt_value(str(int(value)), key)
        return str(int(value))

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return int(value)
        key = get_current_key()
        if key and value.startswith(_ENC_PREFIX):
            return int(decrypt_value(value, key))
        try:
            return int(float(value))
        except (ValueError, TypeError):
            return 0


class EncryptedString(TypeDecorator):
    """String stored encrypted at rest. Transparent to application code."""
    impl = String
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        key = get_current_key()
        if key:
            return encrypt_value(value, key)
        return value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        key = get_current_key()
        if key and isinstance(value, str) and value.startswith(_ENC_PREFIX):
            return decrypt_value(value, key)
        return value
