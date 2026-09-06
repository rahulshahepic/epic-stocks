"""The authorization server's HTTP surface.

Discovery, dynamic client registration, authorize + consent, token, revoke,
and the small session-authenticated API the Settings page uses to list and cut
connections.

Rate limiting note, because it is the opposite of the usual advice here: the
token and registration endpoints are called by OpenAI's and Anthropic's
*backends*, not by the user's browser. Every user of this deployment therefore
arrives at them from the same handful of provider egress addresses. A tight
IP-keyed limit would collapse all of them into one bucket and lock everyone out
— the same failure the anonymous-budget rule warns about, one step further
along. So the limits here are flood guards only, and the real bounds are the
row quota on grants, the exact redirect matching, and the nightly prune in
scaffold/oauth/cleanup.py.
"""
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode, urlparse

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from scaffold.auth import (
    JWT_SECRET, decode_jwt, get_current_user, sign_jwt, token_type,
    TOKEN_TYPE_SESSION, _token_from_request,
)
from scaffold.client_ip import client_ip
from scaffold.models import User
from scaffold.quota import ROW_QUOTAS
from scaffold.rate_limit import check_rate_ip_shared
from . import consent as consent_page
from . import scopes as scope_defs
from .clients import (
    MAX_CLIENT_NAME_LEN, MAX_REDIRECT_URIS, RegistrationError, authenticate_client,
    client_redirect_uris, get_client, redirect_uri_registered, register_client,
)
from .settings import host_allowed, mcp_enabled
from . import audit
from .models import OAuthAuthCode, OAuthGrant
from .tokens import (
    AUTH_CODE_TTL, REFRESH_TTL, canonical_resource, code_verifier, issuer,
    mint_access_token, new_secret, pkce_matches, refresh_verifier,
    resource_matches,
)

logger = logging.getLogger(__name__)

well_known_router = APIRouter(tags=["oauth"])
router = APIRouter(prefix="/oauth", tags=["oauth"])
api_router = APIRouter(prefix="/api/oauth", tags=["oauth"])

# How long the browser has to sit on the consent screen before the pending
# request goes stale. Long enough to sign in on the way through.
AUTH_REQUEST_TTL = timedelta(minutes=15)

MAX_GRANTS_PER_USER = ROW_QUOTAS["OAuthGrant"]


def _enabled() -> bool:
    """Whether AI connections are on. Admin-controlled, not deployment config."""
    return mcp_enabled()


def _provider_still_allowed(redirect_uri: str) -> bool:
    """Whether the provider this client returns to is still switched on.

    Checked at authorize *and* at refresh, not only at registration. An admin
    who turns ChatGPT off means it, and a client registered while it was on
    would otherwise keep working for as long as its refresh token lasted.
    """
    return host_allowed(urlparse(redirect_uri).hostname or "")


# ── discovery ───────────────────────────────────────────────────────────────

def _protected_resource_doc(request: Request) -> dict:
    return {
        "resource": canonical_resource(request),
        "authorization_servers": [issuer(request)],
        "scopes_supported": list(scope_defs.SUPPORTED_SCOPES),
        "bearer_methods_supported": ["header"],
    }


def _authorization_server_doc(request: Request) -> dict:
    base = issuer(request)
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/oauth/authorize",
        "token_endpoint": f"{base}/oauth/token",
        "registration_endpoint": f"{base}/oauth/register",
        "revocation_endpoint": f"{base}/oauth/revoke",
        "scopes_supported": list(scope_defs.SUPPORTED_SCOPES),
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": [
            "none", "client_secret_post", "client_secret_basic",
        ],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post"],
        "resource_indicators_supported": True,
    }


@well_known_router.get("/.well-known/oauth-protected-resource")
@well_known_router.get("/.well-known/oauth-protected-resource/mcp")
def protected_resource_metadata(request: Request):
    """RFC 9728. How a client discovers who issues tokens for /mcp."""
    return JSONResponse(_protected_resource_doc(request))


@well_known_router.get("/.well-known/oauth-authorization-server")
@well_known_router.get("/.well-known/oauth-authorization-server/mcp")
def authorization_server_metadata(request: Request):
    """RFC 8414. What this authorization server supports."""
    return JSONResponse(_authorization_server_doc(request))


# ── dynamic client registration ─────────────────────────────────────────────

class RegisterRequest(BaseModel):
    client_name: str | None = Field(None, max_length=MAX_CLIENT_NAME_LEN)
    redirect_uris: list[str] | None = Field(None, max_length=MAX_REDIRECT_URIS)
    grant_types: list[str] | None = Field(None, max_length=10)
    response_types: list[str] | None = Field(None, max_length=10)
    scope: str | None = Field(None, max_length=500)
    token_endpoint_auth_method: str | None = Field(None, max_length=60)


def _registration_error(message: str, code: str = "invalid_client_metadata") -> JSONResponse:
    return JSONResponse({"error": code, "error_description": message}, status_code=400)


@router.post("/register")
def register(body: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    """RFC 7591. Anonymous by design — it is what makes Claude on a phone work."""
    if not _enabled():
        return _registration_error("AI connections are turned off on this server", "access_denied")
    check_rate_ip_shared(client_ip(request), "oauth_register", 60, 3600)

    try:
        uris = body.redirect_uris or []
        if not uris:
            raise RegistrationError("At least one redirect_uri is required")
        requested = scope_defs.parse_scope(body.scope)
        wants_secret = (body.token_endpoint_auth_method or "none") != "none"
        client, raw_secret = register_client(
            db,
            client_name=body.client_name or "AI assistant",
            redirect_uris=uris,
            scope=scope_defs.format_scope(requested),
            wants_secret=wants_secret,
        )
    except RegistrationError as exc:
        return _registration_error(str(exc))
    except scope_defs.ScopeError as exc:
        return _registration_error(str(exc), "invalid_scope")

    payload = {
        "client_id": client.client_id,
        "client_id_issued_at": int(client.created_at.timestamp()),
        "client_name": client.client_name,
        "redirect_uris": client_redirect_uris(client),
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "scope": client.scope,
        "token_endpoint_auth_method": "client_secret_post" if raw_secret else "none",
    }
    if raw_secret:
        # The only time this value exists in a readable form.
        payload["client_secret"] = raw_secret
    return JSONResponse(payload, status_code=201)


# ── authorize ───────────────────────────────────────────────────────────────

def _optional_user(request: Request, db: Session) -> User | None:
    """The signed-in user, or None. The authorize page needs to ask, not demand."""
    token = _token_from_request(request)
    if not token:
        return None
    try:
        payload = decode_jwt(token)
        if token_type(payload) != TOKEN_TYPE_SESSION:
            return None
        user = db.get(User, int(payload["sub"]))
    except (ValueError, KeyError):
        return None
    if not user or int(payload.get("sv", 0)) != int(user.session_version):
        return None
    return user


def _redirect_error(redirect_uri: str, state: str | None, error: str, description: str):
    params = {"error": error, "error_description": description}
    if state:
        params["state"] = state
    joiner = "&" if urlparse(redirect_uri).query else "?"
    return RedirectResponse(f"{redirect_uri}{joiner}{urlencode(params)}", status_code=302)


def _error_page(title: str, message: str, status_code: int = 400):
    return HTMLResponse(consent_page.render_error(title, message), status_code=status_code)


def _csrf_for(session_token: str, request_token: str) -> str:
    import hashlib
    import hmac

    return hmac.new(
        JWT_SECRET.encode(),
        b"oauth-consent\x00" + session_token.encode() + b"\x00" + request_token.encode(),
        hashlib.sha256,
    ).hexdigest()


@router.get("/consent.css")
def consent_stylesheet():
    """The consent screen's stylesheet.

    A real file rather than an inline <style> block because the deployment's
    CSP is `style-src 'self'`, which blocks inline styles — the screen rendered
    as unstyled browser defaults on staging until this existed. Public and
    immutable, so it caches hard.
    """
    return Response(
        content=consent_page.STYLESHEET,
        media_type="text/css",
        headers={"Cache-Control": "public, max-age=3600"},
    )


@router.get("/authorize")
def authorize(request: Request, db: Session = Depends(get_db)):
    if not _enabled():
        return _error_page("Not available", "AI connections are turned off on this server.", 404)

    q = request.query_params
    client = get_client(db, q.get("client_id"))
    if client is None:
        return _error_page(
            "Unknown application",
            "The application that sent you here is not registered with this server.",
        )

    registered = client_redirect_uris(client)
    redirect_uri = q.get("redirect_uri") or (registered[0] if len(registered) == 1 else None)
    if not redirect_uri or not redirect_uri_registered(client, redirect_uri):
        # Never redirect this one: the request has not established that this is
        # a place we should be sending a browser at all.
        return _error_page(
            "Invalid redirect address",
            "The address this application asked to return you to is not one it registered.",
        )

    if not _provider_still_allowed(redirect_uri):
        return _error_page(
            "Connections from here are turned off",
            "An administrator has disabled AI connections from this provider.",
        )

    state = q.get("state")

    if q.get("response_type") != "code":
        return _redirect_error(redirect_uri, state, "unsupported_response_type",
                               "Only the authorization code flow is supported")

    code_challenge = q.get("code_challenge")
    if not code_challenge:
        return _redirect_error(redirect_uri, state, "invalid_request",
                               "PKCE is required: send code_challenge")
    if q.get("code_challenge_method") != "S256":
        return _redirect_error(redirect_uri, state, "invalid_request",
                               "code_challenge_method must be S256")

    try:
        granted = scope_defs.parse_scope(q.get("scope"))
    except scope_defs.ScopeError as exc:
        return _redirect_error(redirect_uri, state, "invalid_scope", str(exc))

    resource = q.get("resource")
    if not resource_matches(resource, canonical_resource(request)):
        return _redirect_error(redirect_uri, state, "invalid_target",
                               "The resource parameter does not name this server")

    request_token = sign_jwt({
        "typ": "authreq",
        "exp": int((datetime.now(timezone.utc) + AUTH_REQUEST_TTL).timestamp()),
        "cid": client.client_id,
        "ru": redirect_uri,
        "sc": scope_defs.format_scope(granted),
        "cc": code_challenge,
        "st": state or "",
        "res": resource or "",
    })

    user = _optional_user(request, db)
    if user is None:
        # Sign in, then come back to exactly this request. The SPA login honours
        # `next` for same-origin paths only.
        nxt = f"/oauth/authorize/resume?request={request_token}"
        return RedirectResponse(f"/login?next={quote(nxt, safe='')}", status_code=302)

    session_token = _token_from_request(request) or ""
    return HTMLResponse(consent_page.render_consent(
        client_name=client.client_name,
        redirect_origin=urlparse(redirect_uri).netloc,
        account_email=user.email,
        scope_labels=[scope_defs.SCOPE_LABELS[s] for s in granted],
        request_token=request_token,
        csrf=_csrf_for(session_token, request_token),
    ))


@router.get("/authorize/resume")
def authorize_resume(request: Request, db: Session = Depends(get_db)):
    """Where the SPA sends the browser after a sign-in that began at /oauth/authorize.

    The pending request is carried in a signed token rather than a table, so
    there is nothing to expire or clean up, and the parameters cannot be edited
    on the way through the login.
    """
    if not _enabled():
        return _error_page("Not available", "AI connections are turned off on this server.", 404)

    try:
        pending = decode_jwt(request.query_params.get("request") or "")
        if pending.get("typ") != "authreq":
            raise ValueError("wrong token type")
    except ValueError:
        return _error_page(
            "That took too long",
            "This connection request has expired. Start again from the application.",
        )

    user = _optional_user(request, db)
    if user is None:
        return _error_page("Not signed in", "Sign in and try connecting again.", 401)

    client = get_client(db, pending.get("cid"))
    if client is None or not redirect_uri_registered(client, pending.get("ru", "")):
        return _error_page("Unknown application", "This application is no longer registered.")

    session_token = _token_from_request(request) or ""
    request_token = request.query_params.get("request") or ""
    return HTMLResponse(consent_page.render_consent(
        client_name=client.client_name,
        redirect_origin=urlparse(pending["ru"]).netloc,
        account_email=user.email,
        scope_labels=[scope_defs.SCOPE_LABELS[s] for s in pending["sc"].split()],
        request_token=request_token,
        csrf=_csrf_for(session_token, request_token),
    ))


@router.post("/authorize")
def authorize_decide(request: Request, decision: str = Form(...),
                     request_token: str = Form(..., alias="request"),
                     csrf: str = Form(...), db: Session = Depends(get_db)):
    if not _enabled():
        return _error_page("Not available", "AI connections are turned off on this server.", 404)

    try:
        pending = decode_jwt(request_token)
        if pending.get("typ") != "authreq":
            raise ValueError("wrong token type")
    except ValueError:
        return _error_page(
            "That took too long",
            "This connection request has expired. Start again from the application.",
        )

    user = _optional_user(request, db)
    if user is None:
        return _error_page("Not signed in", "Sign in and try connecting again.", 401)

    session_token = _token_from_request(request) or ""
    import hmac as _hmac
    if not _hmac.compare_digest(csrf, _csrf_for(session_token, request_token)):
        # The session cookie is SameSite=Lax, so a cross-site POST does not
        # carry it at all. This is the second lock on the same door: without it,
        # anyone who can register a client could try to have a signed-in user
        # approve it without meaning to.
        return _error_page("Could not verify that request", "Please start again.", 400)

    redirect_uri = pending["ru"]
    state = pending.get("st") or None

    client = get_client(db, pending.get("cid"))
    if client is None or not redirect_uri_registered(client, redirect_uri):
        return _error_page("Unknown application", "This application is no longer registered.")

    if decision != "allow":
        return _redirect_error(redirect_uri, state, "access_denied",
                               "The user declined the connection")

    live = db.query(OAuthGrant).filter(OAuthGrant.user_id == user.id).count()
    if live >= MAX_GRANTS_PER_USER:
        return _redirect_error(
            redirect_uri, state, "access_denied",
            f"This account already has the maximum of {MAX_GRANTS_PER_USER} connections. "
            "Disconnect one in Settings and try again.",
        )

    raw_code = new_secret()
    db.add(OAuthAuthCode(
        code=code_verifier(raw_code),
        user_id=user.id,
        client_id=client.client_id,
        redirect_uri=redirect_uri,
        scope=pending["sc"],
        code_challenge=pending["cc"],
        resource=pending.get("res") or None,
        expires_at=datetime.now(timezone.utc) + AUTH_CODE_TTL,
    ))
    db.commit()

    params = {"code": raw_code}
    if state:
        params["state"] = state
    joiner = "&" if urlparse(redirect_uri).query else "?"
    return RedirectResponse(f"{redirect_uri}{joiner}{urlencode(params)}", status_code=302)


# ── token ───────────────────────────────────────────────────────────────────

def _token_error(error: str, description: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse(
        {"error": error, "error_description": description},
        status_code=status_code,
        headers={"Cache-Control": "no-store"},
    )


def _client_secret_from(request: Request, form_secret: str | None) -> str | None:
    """client_secret_post, or the Basic header form of client_secret_basic."""
    if form_secret:
        return form_secret
    header = request.headers.get("Authorization", "")
    scheme, _, credential = header.partition(" ")
    if scheme.lower() != "basic" or not credential.strip():
        return None
    import base64
    try:
        decoded = base64.b64decode(credential.strip()).decode()
    except Exception:
        return None
    _, _, secret = decoded.partition(":")
    return secret or None


def _issue(db: Session, request: Request, grant: OAuthGrant, user: User) -> JSONResponse:
    """Mint a fresh pair and rotate the refresh token."""
    raw_refresh = new_secret()
    grant.refresh_token = refresh_verifier(raw_refresh)
    grant.refresh_expires_at = datetime.now(timezone.utc) + REFRESH_TTL
    grant.last_used_at = datetime.now(timezone.utc)
    db.commit()

    access, expires_in = mint_access_token(
        grant_id=grant.id,
        user_id=user.id,
        session_version=int(user.session_version),
        scope=grant.scope,
        audience=canonical_resource(request),
        client_id=grant.client_id,
    )
    return JSONResponse(
        {
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": expires_in,
            "refresh_token": raw_refresh,
            "scope": grant.scope,
        },
        headers={"Cache-Control": "no-store"},
    )


@router.post("/token")
def token(request: Request, grant_type: str = Form(...),
          code: str | None = Form(None), redirect_uri: str | None = Form(None),
          client_id: str | None = Form(None), code_verifier: str | None = Form(None),
          client_secret: str | None = Form(None), refresh_token: str | None = Form(None),
          resource: str | None = Form(None), db: Session = Depends(get_db)):
    if not _enabled():
        return _token_error("invalid_request", "AI connections are turned off", 404)

    check_rate_ip_shared(client_ip(request), "oauth_token", 600, 900)
    presented_secret = _client_secret_from(request, client_secret)

    if grant_type == "authorization_code":
        return _exchange_code(db, request, code, redirect_uri, client_id,
                              code_verifier, presented_secret)
    if grant_type == "refresh_token":
        return _refresh(db, request, refresh_token, client_id, presented_secret)
    return _token_error("unsupported_grant_type", f"Unsupported grant_type '{grant_type}'")


def _exchange_code(db: Session, request: Request, raw_code: str | None,
                   redirect_uri: str | None, client_id: str | None,
                   verifier: str | None, presented_secret: str | None) -> JSONResponse:
    if not raw_code or not verifier:
        return _token_error("invalid_request", "code and code_verifier are required")

    row = db.query(OAuthAuthCode).filter(
        OAuthAuthCode.code == code_verifier_of(raw_code)
    ).first()
    if row is None:
        return _token_error("invalid_grant", "That code is not valid")

    # Single use, whatever happens next: a code that has been presented once is
    # spent, including when the rest of this request turns out to be wrong.
    expires_at = row.expires_at
    stored = {
        "user_id": row.user_id, "client_id": row.client_id,
        "redirect_uri": row.redirect_uri, "scope": row.scope,
        "code_challenge": row.code_challenge, "resource": row.resource,
    }
    db.delete(row)
    db.commit()

    if _aware(expires_at) < datetime.now(timezone.utc):
        return _token_error("invalid_grant", "That code has expired")
    if client_id and client_id != stored["client_id"]:
        return _token_error("invalid_grant", "That code was issued to another client")
    if redirect_uri and redirect_uri != stored["redirect_uri"]:
        return _token_error("invalid_grant", "redirect_uri does not match the authorization")
    if not pkce_matches(stored["code_challenge"], verifier):
        return _token_error("invalid_grant", "PKCE verification failed")

    client = get_client(db, stored["client_id"])
    if client is None:
        return _token_error("invalid_client", "Unknown client", 401)
    if not authenticate_client(client, presented_secret):
        return _token_error("invalid_client", "Client authentication failed", 401)

    user = db.get(User, stored["user_id"])
    if user is None:
        return _token_error("invalid_grant", "The account no longer exists")

    grant = db.query(OAuthGrant).filter(
        OAuthGrant.user_id == user.id,
        OAuthGrant.client_id == client.client_id,
    ).first()
    if grant is None:
        grant = OAuthGrant(
            user_id=user.id,
            client_id=client.client_id,
            client_name=client.client_name,
            scope=stored["scope"],
            session_version=int(user.session_version),
        )
        db.add(grant)
    else:
        # Re-authorizing replaces the scope with what was just consented to.
        grant.scope = stored["scope"]
        grant.client_name = client.client_name
        grant.session_version = int(user.session_version)
    client.last_used_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(grant)
    audit.record(db, user_id=user.id, grant_id=grant.id,
                 client_name=grant.client_name, event=audit.CONNECTED)
    return _issue(db, request, grant, user)


def _refresh(db: Session, request: Request, raw_refresh: str | None,
             client_id: str | None, presented_secret: str | None) -> JSONResponse:
    if not raw_refresh:
        return _token_error("invalid_request", "refresh_token is required")

    grant = db.query(OAuthGrant).filter(
        OAuthGrant.refresh_token == refresh_verifier(raw_refresh)
    ).first()
    if grant is None:
        return _token_error("invalid_grant", "That refresh token is not valid")
    if grant.refresh_expires_at and _aware(grant.refresh_expires_at) < datetime.now(timezone.utc):
        return _token_error("invalid_grant", "That refresh token has expired")
    if client_id and client_id != grant.client_id:
        return _token_error("invalid_grant", "That token was issued to another client")

    client = get_client(db, grant.client_id)
    if client is None:
        return _token_error("invalid_client", "Unknown client", 401)
    if not authenticate_client(client, presented_secret):
        return _token_error("invalid_client", "Client authentication failed", 401)
    if not any(_provider_still_allowed(uri) for uri in client_redirect_uris(client)):
        # Switched off since this connection was made. Drop it rather than
        # letting it live out its refresh window.
        db.delete(grant)
        db.commit()
        return _token_error("invalid_grant", "AI connections from this provider are turned off")

    user = db.get(User, grant.user_id)
    if user is None:
        return _token_error("invalid_grant", "The account no longer exists")
    if int(grant.session_version) != int(user.session_version):
        # Signed out everywhere since this was authorized.
        db.delete(grant)
        db.commit()
        return _token_error("invalid_grant", "This connection was signed out. Connect again.")

    return _issue(db, request, grant, user)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def code_verifier_of(raw: str) -> str:
    """Named apart from the `code_verifier` form field, which means something else."""
    return code_verifier(raw)


@router.post("/revoke")
def revoke(request: Request, token: str = Form(...),
           token_type_hint: str | None = Form(None), db: Session = Depends(get_db)):
    """RFC 7009. Always 200, so a caller cannot probe which tokens exist."""
    grant = db.query(OAuthGrant).filter(
        OAuthGrant.refresh_token == refresh_verifier(token)
    ).first()
    if grant is None:
        try:
            payload = decode_jwt(token)
            if token_type(payload) == "mcp" and payload.get("gid"):
                grant = db.get(OAuthGrant, int(payload["gid"]))
        except (ValueError, KeyError, TypeError):
            grant = None
    if grant is not None:
        user_id, grant_id, name = grant.user_id, grant.id, grant.client_name
        db.delete(grant)
        db.commit()
        audit.record(db, user_id=user_id, grant_id=grant_id,
                     client_name=name, event=audit.DISCONNECTED)
    return JSONResponse({}, status_code=200)


# ── the connections list, for Settings ──────────────────────────────────────

@api_router.get("/connections")
def list_connections(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(OAuthGrant).filter(
        OAuthGrant.user_id == user.id
    ).order_by(OAuthGrant.created_at.desc()).all()
    return [
        {
            "id": g.id,
            "client_name": g.client_name or "AI assistant",
            "scopes": g.scope.split(),
            "created_at": g.created_at.isoformat() if g.created_at else None,
            "last_used_at": g.last_used_at.isoformat() if g.last_used_at else None,
        }
        for g in rows
    ]


MAX_ACTIVITY_ROWS = 50


@api_router.get("/activity")
def my_activity(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """What this account's assistants have done lately.

    Tool names and times, never figures — the audit table holds no financial
    data, so there is none to show. Enough to answer "did it read my salary?".
    """
    from .models import McpAudit

    rows = db.query(McpAudit).filter(
        McpAudit.user_id == user.id
    ).order_by(McpAudit.created_at.desc(), McpAudit.id.desc()).limit(MAX_ACTIVITY_ROWS).all()
    return [
        {
            "id": r.id,
            "client_name": r.client_name or "AI assistant",
            "event": r.event,
            "tool": r.tool,
            "outcome": r.outcome,
            "at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@api_router.delete("/connections/{grant_id}", status_code=204)
def disconnect(grant_id: int, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    """Deleting the row is the revocation — every /mcp call loads it."""
    grant = db.query(OAuthGrant).filter(
        OAuthGrant.id == grant_id, OAuthGrant.user_id == user.id
    ).first()
    if grant is None:
        raise HTTPException(404, "Connection not found")
    name = grant.client_name
    db.delete(grant)
    db.commit()
    audit.record(db, user_id=user.id, grant_id=grant_id,
                 client_name=name, event=audit.DISCONNECTED)
