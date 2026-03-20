"""
Per-user column-level encryption using AES-256-GCM.

When ENCRYPTION_MASTER_KEY is set:
  - Each user gets a random 256-bit key (stored encrypted with master key)
  - Sensitive fields are encrypted before INSERT, decrypted after SELECT
  - Encrypted values are prefixed with "$ENC$" to distinguish from plaintext

When ENCRYPTION_MASTER_KEY is not set:
  - No encryption, values pass through as strings
  - Existing data remains readable
"""

import os
import base64
import hashlib
from contextvars import ContextVar

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

ENCRYPTION_MASTER_KEY = os.getenv("ENCRYPTION_MASTER_KEY", "")

_current_key: ContextVar[bytes | None] = ContextVar("_current_key", default=None)

_ENC_PREFIX = "$ENC$"


def encryption_enabled() -> bool:
    return bool(ENCRYPTION_MASTER_KEY)


def _master_aesgcm() -> AESGCM:
    key = hashlib.sha256(ENCRYPTION_MASTER_KEY.encode()).digest()
    return AESGCM(key)


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


def encrypt_value(plaintext: str, key: bytes) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(key).encrypt(nonce, plaintext.encode(), None)
    return _ENC_PREFIX + base64.b64encode(nonce + ct).decode()


def decrypt_value(ciphertext: str, key: bytes) -> str:
    data = base64.b64decode(ciphertext[len(_ENC_PREFIX):])
    return AESGCM(key).decrypt(data[:12], data[12:], None).decode()


# ============================================================
# SQLAlchemy TypeDecorators
# ============================================================

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
