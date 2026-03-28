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

import json
import os
from dataclasses import dataclass, field
from urllib.parse import urlencode

import httpx
from joserfc import jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet
from joserfc.jwt import JWTClaimsRegistry

from .base import UserIdentity

# Process-lifetime caches — refreshed on restart (sufficient for cert rotation windows)
_oidc_config_cache: dict[str, dict] = {}
_jwks_cache: dict[str, dict] = {}


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

    def _verify_id_token(self, id_token: str, _force_jwks: bool = False) -> UserIdentity:
        oidc = self._oidc()
        # Strict algorithm whitelist from the provider's metadata — prevents confusion attacks.
        allowed_algs = oidc.get("id_token_signing_alg_values_supported") or ["RS256"]

        jwks = _fetch_jwks(oidc["jwks_uri"], force=_force_jwks)
        key_set = KeySet.import_key_set(jwks)

        try:
            token = jwt.decode(id_token, key_set, algorithms=allowed_algs)
        except JoseError:
            if not _force_jwks:
                # Unknown kid — provider may have rotated keys; retry with a fresh JWKS fetch.
                return self._verify_id_token(id_token, _force_jwks=True)
            raise ValueError("JWT verification failed")

        registry = JWTClaimsRegistry(
            iss={"essential": True, "value": oidc.get("issuer")},
            aud={"essential": True, "value": self.config.client_id},
            exp={"essential": True},
        )
        try:
            registry.validate(token.claims)
        except JoseError as exc:
            raise ValueError(f"JWT claims invalid: {exc}") from exc

        sub = token.claims.get(self.config.subject_claim)
        if not sub:
            raise ValueError(f"Missing {self.config.subject_claim!r} claim in token")
        email = token.claims.get("email") or token.claims.get("preferred_username", "")

        return UserIdentity(
            provider_sub=sub,
            email=email,
            email_verified=bool(token.claims.get("email_verified", True)),
            name=token.claims.get("name"),
            picture=token.claims.get("picture"),
        )


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
