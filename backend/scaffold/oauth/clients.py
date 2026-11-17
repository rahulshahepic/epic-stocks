"""Client registration, and the rules about where a client may be sent back to.

Dynamic client registration is anonymous by design — it is what lets Claude on
a phone connect without anyone copying a client id around. It also means a
stranger can register a client naming any redirect URI they like, which is the
open-redirect and confused-deputy surface. Three things close it:

  * the URI must match a rule on the allowlist an admin maintains
    (settings.py) — an exact callback for every provider that publishes one,
  * redirect URIs are matched exactly at authorize time, never by prefix,
  * consent is shown every time, and it shows the origin the browser will be
    returned to rather than the display name the client chose for itself.

The allowlist is the cheap one and it removes the whole class. This app has a
small, known set of clients; nothing is lost by naming them.
"""
import ipaddress
import json
import os
import secrets
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from .models import OAuthClient
from .settings import has_any_rule, host_covered, uri_allowed
from .tokens import client_secret_verifier, new_secret

MAX_REDIRECT_URIS = 5
MAX_CLIENT_NAME_LEN = 120


class RegistrationError(ValueError):
    """Registration was refused. The message reaches the client."""


def _is_loopback(host: str) -> bool:
    if host in ("localhost", "127.0.0.1", "::1"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def validate_redirect_uri(uri: str) -> None:
    """Raise RegistrationError unless this is somewhere we are willing to send a browser.

    Deliberately independent of the E2E_TEST switch. That switch already turns
    off redirect_uri validation for the OIDC *login* flow, and an authorization
    server that inherited it would hand authorization codes to anywhere the
    caller named the moment someone set the variable on something reachable.
    """
    try:
        parsed = urlparse(uri)
        _ = parsed.port  # raises on a malformed port
    except ValueError:
        raise RegistrationError("redirect_uri is not a valid URL") from None

    if parsed.fragment:
        raise RegistrationError("redirect_uri must not contain a fragment")
    if "@" in parsed.netloc or "\\" in uri or any(ord(c) < 33 for c in uri):
        raise RegistrationError("redirect_uri is not a valid URL")
    host = (parsed.hostname or "").lower()
    if not host:
        raise RegistrationError("redirect_uri must be absolute")

    if _is_loopback(host):
        # OAuth 2.1 allows http for loopback, which is how a locally run MCP
        # client authorizes. On a real deployment an attacker's "localhost" is
        # the victim's own machine, so it is refused unless an admin has
        # switched a loopback rule on (they are seeded off when DOMAIN is set).
        if parsed.scheme not in ("http", "https"):
            raise RegistrationError("redirect_uri must be http or https")
        if os.getenv("DOMAIN") and not uri_allowed(uri):
            raise RegistrationError("Loopback redirect URIs are not accepted on this server")
        return

    if parsed.scheme != "https":
        raise RegistrationError("redirect_uri must use https")

    if not uri_allowed(uri):
        if not has_any_rule():
            raise RegistrationError(
                "This server is not accepting AI connections from anywhere. "
                "An administrator has to add a provider first."
            )
        raise RegistrationError(
            f"This server does not accept {uri} as a redirect address. "
            "The site administrator has been told; it can be allowed in "
            "Admin → AI Connections."
        )


def provider_still_allowed(redirect_uri: str) -> bool:
    """Whether the provider a registered client returns to is still switched on."""
    host = (urlparse(redirect_uri).hostname or "").lower()
    if _is_loopback(host) and not os.getenv("DOMAIN"):
        return True
    return host_covered(host)


def register_client(db: Session, *, client_name: str, redirect_uris: list[str],
                    scope: str, wants_secret: bool) -> tuple[OAuthClient, str | None]:
    """Create a client row. Returns (client, raw_secret_or_None)."""
    if not redirect_uris:
        raise RegistrationError("At least one redirect_uri is required")
    if len(redirect_uris) > MAX_REDIRECT_URIS:
        raise RegistrationError(f"At most {MAX_REDIRECT_URIS} redirect URIs")
    for uri in redirect_uris:
        if not isinstance(uri, str):
            raise RegistrationError("redirect_uris must be strings")
        try:
            validate_redirect_uri(uri)
        except RegistrationError as exc:
            from .settings import record_rejection
            record_rejection(db, uri, client_name, str(exc))
            raise

    name = (client_name or "Unnamed client").strip()[:MAX_CLIENT_NAME_LEN]

    raw_secret = new_secret() if wants_secret else None
    client = OAuthClient(
        client_id=secrets.token_urlsafe(24),
        client_secret=client_secret_verifier(raw_secret) if raw_secret else None,
        client_name=name,
        redirect_uris=json.dumps(redirect_uris),
        scope=scope,
    )
    db.add(client)
    db.commit()
    db.refresh(client)
    return client, raw_secret


def get_client(db: Session, client_id: str | None) -> OAuthClient | None:
    if not client_id:
        return None
    return db.query(OAuthClient).filter(OAuthClient.client_id == client_id).first()


def client_redirect_uris(client: OAuthClient) -> list[str]:
    try:
        value = json.loads(client.redirect_uris)
    except (ValueError, TypeError):
        return []
    return [u for u in value if isinstance(u, str)] if isinstance(value, list) else []


def redirect_uri_registered(client: OAuthClient, redirect_uri: str) -> bool:
    """Exact match, never a prefix. A prefix match is an open redirect."""
    return redirect_uri in client_redirect_uris(client)


def authenticate_client(client: OAuthClient, presented_secret: str | None) -> bool:
    """A public client authenticates with PKCE alone; a confidential one needs its secret."""
    import hmac as _hmac

    if client.client_secret is None:
        return True
    if not presented_secret:
        return False
    return _hmac.compare_digest(client.client_secret, client_secret_verifier(presented_secret))
