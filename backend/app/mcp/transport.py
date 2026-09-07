"""JSON-RPC over Streamable HTTP, at POST /mcp.

Hand-rolled rather than pulled from the MCP SDK: the surface a server this
shape needs is five methods and a handshake, the repo already hand-rolls its
JWTs, and the transport has to sit inside the existing ASGI middleware stack
(encryption context, body limit, rate limit) rather than beside it.

This server initiates nothing, so there is no SSE stream to hold open and a
plain JSON response is a complete answer. GET therefore has nothing to offer
and says so with 405.

Every failure inside here becomes a JSON-RPC error object, never an exception.
An unhandled exception would be a 500, and a 500 writes an error_logs row —
which the nightly job then counts against the 500-row window that real
tracebacks live in. A confused assistant must not be able to evict them.
"""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy.orm import Session

from database import get_db
from scaffold.oauth import audit
from scaffold.oauth.resource import Connector, require_connector
from scaffold.oauth.settings import mcp_enabled
from scaffold.rate_limit import check_rate_shared
from . import import_tools, read_tools  # noqa: F401  — importing is what registers the tools
from .tools import REGISTRY, ToolContext, as_result, visible_to

logger = logging.getLogger(__name__)

router = APIRouter(tags=["mcp"])

# Per-minute ceilings on /mcp. Two of them, because one user may have both
# ChatGPT and Claude connected and a runaway loop in one must not starve the
# other — the per-connection limit stops that, and the per-account limit is
# what actually bounds a single user's cost to the server.
#
# Nothing else covers this endpoint: MutationRateLimitMiddleware only inspects
# /api/ paths, and the IP-keyed limits on /oauth/* would be useless here anyway
# because every request arrives from the provider's own servers, not the
# user's. list_events recomputes a timeline, so an unlimited connector is a
# real cost.
PER_CONNECTION_LIMIT = 120
PER_ACCOUNT_LIMIT = 300

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26")

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


def _result(request_id: Any, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _tool_failure(request_id: Any, message: str) -> dict:
    """A tool that could not do its job.

    Reported as a successful call carrying isError, which is how MCP says "the
    tool ran and failed" as opposed to "the request was malformed". The model
    sees the text and can explain or retry; a protocol error just stops it.
    """
    return _result(request_id, {
        "content": [{"type": "text", "text": message}],
        "isError": True,
    })


def _refuse_when_disabled():
    """AI connections are an admin switch, so this is checked per request.

    503 rather than 404: the endpoint exists and is expected back, which is
    what a client should retry against rather than forget.
    """
    if not mcp_enabled():
        raise HTTPException(
            status_code=503,
            detail="AI connections are turned off on this server",
        )


@router.get("/mcp")
def mcp_get():
    return JSONResponse(
        {"detail": "This MCP server does not open server-initiated streams. Use POST."},
        status_code=405,
        headers={"Allow": "POST"},
    )


def _enforce_rate_limits(connector: Connector) -> None:
    """Raise 429 when this connection, or this account, is calling too fast."""
    check_rate_shared(connector.grant.id, "mcp_connection", PER_CONNECTION_LIMIT, 60)
    check_rate_shared(connector.user.id, "mcp_account", PER_ACCOUNT_LIMIT, 60)


@router.post("/mcp", dependencies=[Depends(_refuse_when_disabled)])
async def mcp_post(request: Request, connector: Connector = Depends(require_connector),
                   db: Session = Depends(get_db)):
    _enforce_rate_limits(connector)
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_error(None, PARSE_ERROR, "Request body is not valid JSON"))

    if isinstance(body, list):
        # Batching was removed in 2025-06-18.
        return JSONResponse(_error(None, INVALID_REQUEST, "Batched requests are not supported"))
    if not isinstance(body, dict):
        return JSONResponse(_error(None, INVALID_REQUEST, "Request must be a JSON object"))

    request_id = body.get("id")
    method = body.get("method")
    params = body.get("params")
    if not isinstance(params, dict):
        params = {}

    if not isinstance(method, str):
        return JSONResponse(_error(request_id, INVALID_REQUEST, "Missing method"))

    # A notification carries no id and expects no body.
    if request_id is None and method.startswith("notifications/"):
        return Response(status_code=202)

    try:
        payload = _dispatch(method, params, request_id, ToolContext(connector=connector, db=db))
    except Exception:
        logger.exception("MCP method %s failed", method)
        payload = _error(request_id, INTERNAL_ERROR, "The server could not complete that request")

    if payload is None:
        return Response(status_code=202)
    return JSONResponse(payload)


def _dispatch(method: str, params: dict, request_id: Any, ctx: ToolContext) -> dict | None:
    connector = ctx.connector

    if method == "initialize":
        asked = params.get("protocolVersion")
        version = asked if asked in SUPPORTED_PROTOCOL_VERSIONS else PROTOCOL_VERSION
        return _result(request_id, {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "epic-stocks", "title": "Epic Stocks", "version": "1"},
            "instructions": (
                "Equity vesting, loans, sales and tax figures for the signed-in "
                "account.\n\n"
                "Call explain before reasoning about the numbers. This is a "
                "private-company scheme and several ordinary RSU rules do not "
                "hold: some grants have a zero cost basis and are taxed as they "
                "vest, others are bought at market value and vesting only lifts "
                "a sale restriction.\n\n"
                "list_events computes the whole timeline on every call — filter "
                "it by date range or event type rather than pulling everything, "
                "and check `truncated` before totalling what comes back.\n\n"
                "Helping someone enter their equity: read get_import_guide "
                "first, then stage_import. Vesting dates and periods are fixed "
                "company-wide and must not be invented. stage_import changes "
                "nothing on its own — it leaves a draft the user accepts in the "
                "app, so say that rather than reporting the import as done."
            ),
        })

    if method == "ping":
        return _result(request_id, {})

    if method == "tools/list":
        return _result(request_id, {
            "tools": [tool.describe() for tool in visible_to(connector)],
        })

    if method == "tools/call":
        return _call_tool(params, request_id, ctx)

    if method.startswith("notifications/"):
        return None

    return _error(request_id, METHOD_NOT_FOUND, f"Unknown method '{method}'")


def _call_tool(params: dict, request_id: Any, ctx: ToolContext) -> dict:
    connector = ctx.connector
    name = params.get("name")
    if not isinstance(name, str) or not name:
        return _error(request_id, INVALID_PARAMS, "A tool name is required")

    tool = REGISTRY.get(name)
    if tool is None:
        return _error(request_id, INVALID_PARAMS, f"Unknown tool '{name}'")

    # Recorded before it runs, so a read cannot happen without a record of it.
    # A failure here refuses the call rather than serving data off the books.
    entry = audit.start_tool_call(
        ctx.db,
        user_id=connector.user.id,
        grant_id=connector.grant.id,
        client_name=connector.grant.client_name,
        tool=name,
        scope=tool.scope,
    )

    if tool.scope not in connector.scopes:
        audit.finish_tool_call(ctx.db, entry, audit.DENIED)
        return _tool_failure(
            request_id,
            f"This connection was not granted the '{tool.scope}' permission. "
            "Reconnect it and allow that permission to use this tool.",
        )

    arguments = params.get("arguments")
    if not isinstance(arguments, dict):
        arguments = {}

    try:
        answer = _result(request_id, as_result(tool.handler(ctx, arguments)))
    except ValueError as exc:
        # A bad argument is a finding the model can act on, not a crash.
        audit.finish_tool_call(ctx.db, entry, audit.ERROR)
        return _tool_failure(request_id, str(exc))
    except Exception:
        audit.finish_tool_call(ctx.db, entry, audit.ERROR)
        raise

    audit.finish_tool_call(ctx.db, entry, audit.OK)
    return answer
