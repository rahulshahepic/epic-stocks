from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass
class UserIdentity:
    provider_sub: str   # unique identifier from provider (Google sub, Azure oid)
    email: str
    email_verified: bool
    name: str | None
    picture: str | None


@runtime_checkable
class AuthProvider(Protocol):
    def get_client_id(self) -> str: ...
    def get_authorization_url(self, state: str, code_challenge: str, redirect_uri: str) -> str: ...
    def exchange_code(self, code: str, code_verifier: str, redirect_uri: str) -> UserIdentity: ...
