"""Generic OIDC auth provider — works with any standards-compliant IdP.

Configure via OIDC_PROVIDERS environment variable (JSON array):

  [
    {
      "name": "google",
      "label": "Google",
      "client_id": "...",
      "client_secret": "...",
      "discovery_url": "https://accounts.google.com/.well-known/openid-configuration"
    },
    {
      "name": "azure",
      "label": "Azure AD",
      "client_id": "...",
      "client_secret": "...",
      "discovery_url": "https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration",
      "subject_claim": "oid"
    }
  ]

subject_claim defaults to "sub". Set to "oid" for Azure Entra ID, where the
object ID is the stable per-user identifier across client apps.
"""

import base64
import json
import os
import time
from dataclasses import dataclass, field
from urllib.parse import urlencode

import httpx

from .base import UserIdentity

# Process-lifetime caches — refreshed on restart (sufficient for cert rotation windows)
_oidc_config_cache: dict[str, dict] = {}
_jwks_cache: dict[str, dict] = {}


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * pad)


def _b64url_to_int(s: str) -> int:
    return int.from_bytes(_b64url_decode(s), "big")


def _fetch_oidc_config(discovery_url: str) -> dict:
    if discovery_url not in _oidc_config_cache:
        resp = httpx.get(discovery_url, timeout=10)
        resp.raise_for_status()
        _oidc_config_cache[discovery_url] = resp.json()
    return _oidc_config_cache[discovery_url]


def _fetch_jwks(jwks_uri: str, force: bool = False) -> dict:
    if force or jwks_uri not in _jwks_cache:
        resp = httpx.get(jwks_uri, timeout=10)
        resp.raise_for_status()
        _jwks_cache[jwks_uri] = resp.json()
    return _jwks_cache[jwks_uri]


@dataclass
class OIDCProviderConfig:
    name: str
    client_id: str
    discovery_url: str
    client_secret: str = ""
    label: str = ""
    scopes: list[str] = field(default_factory=lambda: ["openid", "email", "profile"])
    subject_claim: str = "sub"

    def __post_init__(self):
        if not self.label:
            self.label = self.name.capitalize()


class OIDCProvider:
    def __init__(self, config: OIDCProviderConfig):
        self.config = config

    def _oidc(self) -> dict:
        return _fetch_oidc_config(self.config.discovery_url)

    def get_authorization_url(self, state: str, code_challenge: str, redirect_uri: str) -> str:
        params = {
            "client_id": self.config.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(self.config.scopes),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "response_mode": "query",
        }
        return self._oidc()["authorization_endpoint"] + "?" + urlencode(params)

    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> UserIdentity:
        payload: dict = {
            "code": code,
            "client_id": self.config.client_id,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        }
        if self.config.client_secret:
            payload["client_secret"] = self.config.client_secret
        resp = httpx.post(self._oidc()["token_endpoint"], data=payload, timeout=10)
        if resp.status_code != 200:
            raise ValueError(f"Token exchange failed: {resp.text}")
        id_token = resp.json().get("id_token")
        if not id_token:
            raise ValueError("No id_token in token response")
        return self._verify_id_token(id_token)

    def _verify_id_token(self, id_token: str) -> UserIdentity:
        parts = id_token.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed JWT")

        header = json.loads(_b64url_decode(parts[0]))
        kid = header.get("kid")
        alg = header.get("alg", "RS256")

        # Validate alg against what the provider advertises — prevents algorithm confusion.
        oidc = self._oidc()
        allowed_algs = oidc.get("id_token_signing_alg_values_supported") or ["RS256"]
        if alg not in allowed_algs:
            raise ValueError(f"Token alg {alg!r} not in provider's allowed list: {allowed_algs}")

        jwks_uri = oidc["jwks_uri"]
        key_data = self._find_key(jwks_uri, kid, force=False)
        if key_data is None:
            # Unknown kid — provider may have rotated keys; retry with a fresh fetch.
            key_data = self._find_key(jwks_uri, kid, force=True)
        if key_data is None:
            raise ValueError(f"No matching key found (kid={kid})")

        message = f"{parts[0]}.{parts[1]}".encode()
        signature = _b64url_decode(parts[2])

        if alg in ("RS256", "RS384", "RS512"):
            self._verify_rsa(key_data, message, signature, alg)
        else:
            raise ValueError(f"Unsupported signing algorithm: {alg}")

        payload = json.loads(_b64url_decode(parts[1]))

        if payload.get("exp", 0) < time.time():
            raise ValueError("Token expired")
        if payload.get("iss") != oidc.get("issuer"):
            raise ValueError(f"Token issuer mismatch: {payload.get('iss')!r}")
        aud = payload.get("aud")
        if isinstance(aud, list):
            if self.config.client_id not in aud:
                raise ValueError("Token audience mismatch")
        elif aud != self.config.client_id:
            raise ValueError("Token audience mismatch")

        sub = payload.get(self.config.subject_claim)
        if not sub:
            raise ValueError(f"Missing {self.config.subject_claim!r} claim in token")
        email = payload.get("email") or payload.get("preferred_username", "")

        return UserIdentity(
            provider_sub=sub,
            email=email,
            email_verified=bool(payload.get("email_verified", True)),
            name=payload.get("name"),
            picture=payload.get("picture"),
        )

    @staticmethod
    def _find_key(jwks_uri: str, kid: str | None, force: bool) -> dict | None:
        jwks = _fetch_jwks(jwks_uri, force=force)
        if kid:
            return next((k for k in jwks["keys"] if k.get("kid") == kid), None)
        # Some providers omit kid — fall back to first key.
        return jwks["keys"][0] if jwks.get("keys") else None

    @staticmethod
    def _verify_rsa(key_data: dict, message: bytes, signature: bytes, alg: str):
        from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

        hash_alg = {"RS256": hashes.SHA256(), "RS384": hashes.SHA384(), "RS512": hashes.SHA512()}[alg]
        pub_key = RSAPublicNumbers(
            e=_b64url_to_int(key_data["e"]),
            n=_b64url_to_int(key_data["n"]),
        ).public_key(default_backend())
        try:
            pub_key.verify(signature, message, asym_padding.PKCS1v15(), hash_alg)
        except Exception:
            raise ValueError("Token signature verification failed")


def get_providers() -> list[OIDCProvider]:
    """Parse OIDC_PROVIDERS env var and return configured provider instances."""
    raw = os.getenv("OIDC_PROVIDERS", "")
    if not raw:
        return []
    try:
        configs = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"OIDC_PROVIDERS is not valid JSON: {e}")
    return [OIDCProvider(OIDCProviderConfig(**c)) for c in configs]
