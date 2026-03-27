"""Azure Entra ID (formerly Azure AD) OIDC auth provider via PKCE."""
import base64
import json
import os
import time
from functools import lru_cache
from urllib.parse import urlencode

import httpx

from .base import UserIdentity


@lru_cache(maxsize=1)
def _fetch_oidc_config(tenant_id: str) -> dict:
    """Fetch and cache the Azure Entra OIDC discovery document for this process lifetime."""
    url = f"https://login.microsoftonline.com/{tenant_id}/v2.0/.well-known/openid-configuration"
    resp = httpx.get(url, timeout=10)
    resp.raise_for_status()
    return resp.json()


@lru_cache(maxsize=1)
def _fetch_jwks(jwks_uri: str) -> dict:
    """Fetch and cache Azure's JWKS (public key set) for token verification."""
    resp = httpx.get(jwks_uri, timeout=10)
    resp.raise_for_status()
    return resp.json()


def _b64url_to_int(s: str) -> int:
    pad = 4 - len(s) % 4
    b = base64.urlsafe_b64decode(s + "=" * pad)
    return int.from_bytes(b, "big")


def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * pad)


class AzureEntraAuthProvider:
    def __init__(self):
        self.tenant_id = os.getenv("AZURE_TENANT_ID", "")
        self.client_id = os.getenv("AZURE_CLIENT_ID", "")
        self.client_secret = os.getenv("AZURE_CLIENT_SECRET", "")

    def get_client_id(self) -> str:
        return self.client_id

    def _oidc(self) -> dict:
        return _fetch_oidc_config(self.tenant_id)

    def get_authorization_url(self, state: str, code_challenge: str, redirect_uri: str) -> str:
        auth_endpoint = self._oidc()["authorization_endpoint"]
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "response_mode": "query",
        }
        return auth_endpoint + "?" + urlencode(params)

    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> UserIdentity:
        token_endpoint = self._oidc()["token_endpoint"]
        resp = httpx.post(token_endpoint, data={
            "code": code,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
            "code_verifier": code_verifier,
        }, timeout=10)
        if resp.status_code != 200:
            raise ValueError(f"Token exchange failed: {resp.text}")
        id_token = resp.json().get("id_token")
        if not id_token:
            raise ValueError("No id_token in Azure token response")
        return self._verify_id_token(id_token)

    def _verify_id_token(self, id_token: str) -> UserIdentity:
        from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
        from cryptography.hazmat.backends import default_backend
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding as asym_padding

        parts = id_token.split(".")
        if len(parts) != 3:
            raise ValueError("Malformed JWT")

        header = json.loads(_b64url_decode(parts[0]))
        kid = header.get("kid")

        jwks = _fetch_jwks(self._oidc()["jwks_uri"])
        key = next((k for k in jwks["keys"] if k.get("kid") == kid), None)
        if not key:
            raise ValueError(f"Unknown key ID: {kid}")

        pub_key = RSAPublicNumbers(
            e=_b64url_to_int(key["e"]),
            n=_b64url_to_int(key["n"]),
        ).public_key(default_backend())

        message = f"{parts[0]}.{parts[1]}".encode()
        signature = _b64url_decode(parts[2])
        try:
            pub_key.verify(signature, message, asym_padding.PKCS1v15(), hashes.SHA256())
        except Exception:
            raise ValueError("Token signature verification failed")

        payload = json.loads(_b64url_decode(parts[1]))

        if payload.get("exp", 0) < time.time():
            raise ValueError("Token expired")
        if payload.get("aud") != self.client_id:
            raise ValueError("Token audience mismatch")
        iss = payload.get("iss", "")
        if self.tenant_id not in iss:
            raise ValueError("Token issuer mismatch")

        email = payload.get("email") or payload.get("preferred_username", "")
        return UserIdentity(
            provider_sub=payload["oid"],  # Azure object ID is the stable per-user identifier
            email=email,
            email_verified=bool(payload.get("email_verified", True)),
            name=payload.get("name"),
            picture=None,  # Azure Entra ID does not expose profile pictures via OIDC
        )
