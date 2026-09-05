"""Invitation secrets, kept out of the database in usable form.

An invitation token is a bearer credential: whoever presents it gets read
access to the inviter's financial data. Both the token and the short code used
to sit in `invitations` as plaintext, so anyone who could read the table — a
dump, a backup, a replica, a stray SELECT — could redeem every pending
invitation. Acceptance does not require the accepting account's email to match
the one invited, so a stolen token works from any signed-in account.

Nothing here is stored in a form the database alone can use:

  token       an HMAC-SHA256 verifier. The raw token exists only long enough
              to build the email link. Lookup hashes what the caller presents
              and compares — still a single indexed equality match, no scan.

  short_code  the same verifier for lookup, plus a sealed copy under
              short_code_sealed so the inviter can still be shown the code in
              the sent-invitations list ("share this manually if they didn't
              get the email"). Sealed rather than hashed because that feature
              needs the value back; AES-256-GCM under a key held in the
              environment, so a database read on its own yields nothing.

The secret is INVITE_TOKEN_SECRET when set, otherwise JWT_SECRET, which is
already required to be long and random. Rotating it invalidates outstanding
invitations and makes stored codes undisplayable — they can be revoked and
re-sent, which is why this is not a new required deployment variable.
"""
import base64
import hashlib
import hmac
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_TOKEN_LABEL = b"epic-stocks/invite-token"
_CODE_LABEL = b"epic-stocks/invite-code"
_SEAL_LABEL = b"epic-stocks/invite-code-seal"


def _secret() -> bytes:
    """Read at call time so tests and rotations do not need a reimport."""
    raw = os.getenv("INVITE_TOKEN_SECRET") or os.getenv("JWT_SECRET") or ""
    if not raw:
        # Only reachable in the test environment, where auth.py supplies a
        # default JWT_SECRET; production refuses to start without one.
        raw = "dev-secret-change-me"
    return raw.encode()


def _verifier(value: str, label: bytes) -> str:
    return hmac.new(_secret(), label + b"\x00" + value.encode(), hashlib.sha256).hexdigest()


def token_verifier(raw_token: str) -> str:
    """What goes in invitations.token for a given raw token."""
    return _verifier(raw_token, _TOKEN_LABEL)


def code_verifier(raw_code: str) -> str:
    """What goes in invitations.short_code for a given raw code.

    Callers must normalise (strip separators, upper-case) first; this hashes
    exactly what it is given.
    """
    return _verifier(raw_code, _CODE_LABEL)


def _seal_key() -> bytes:
    return hashlib.sha256(_SEAL_LABEL + b"\x00" + _secret()).digest()


def seal_code(raw_code: str) -> str:
    nonce = os.urandom(12)
    ct = AESGCM(_seal_key()).encrypt(nonce, raw_code.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def unseal_code(sealed: str | None) -> str | None:
    """The raw code, or None if it cannot be recovered.

    Returns None rather than raising: an unreadable code (secret rotated, row
    predating the sealed column) must not break the whole sent-invitations
    list, which is mostly other people's invitations.
    """
    if not sealed:
        return None
    try:
        data = base64.b64decode(sealed)
        return AESGCM(_seal_key()).decrypt(data[:12], data[12:], None).decode()
    except Exception:
        return None
