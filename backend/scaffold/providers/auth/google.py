"""Google OIDC auth provider — supports both PKCE and legacy GSI token flows."""
import os
from urllib.parse import urlencode
import httpx
from .base import UserIdentity

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"


class GoogleAuthProvider:
    def __init__(self):
        self.client_id = os.getenv("GOOGLE_CLIENT_ID", "")
        self.client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")

    def get_client_id(self) -> str:
        return self.client_id

    def get_authorization_url(self, state: str, code_challenge: str, redirect_uri: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "access_type": "online",
            "prompt": "select_account",
        }
        return GOOGLE_AUTH_URL + "?" + urlencode(params)

    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> UserIdentity:
        resp = httpx.post(GOOGLE_TOKEN_URL, data={
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
            raise ValueError("No id_token in Google token response")
        return self._verify_id_token(id_token)

    def _verify_id_token(self, id_token: str) -> UserIdentity:
        payload = self._fetch_tokeninfo(id_token)
        return UserIdentity(
            provider_sub=payload["sub"],
            email=payload["email"],
            email_verified=True,
            name=payload.get("name"),
            picture=payload.get("picture"),
        )

    def _fetch_tokeninfo(self, id_token: str) -> dict:
        resp = httpx.get(GOOGLE_TOKENINFO_URL, params={"id_token": id_token}, timeout=10)
        if resp.status_code != 200:
            raise ValueError("Invalid Google token")
        payload = resp.json()
        if payload.get("aud") != self.client_id:
            raise ValueError("Token not issued for this app")
        if payload.get("email_verified") not in ("true", True):
            raise ValueError("Email not verified")
        return payload


# Module-level function kept for backward-compatible test patching via conftest.py
def verify_google_token(id_token: str) -> dict:
    """Verify a Google ID token and return the raw tokeninfo payload.

    Used by the legacy POST /api/auth/google endpoint (still supported for
    test environments). New code should use GoogleAuthProvider.exchange_code.
    """
    return GoogleAuthProvider()._fetch_tokeninfo(id_token)
