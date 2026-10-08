"""MCP Apps presentation, using the same scoped reads as the text connector."""
import os
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

from scaffold.oauth.scopes import EQUITY_READ
from .read_tools import _opt_date
from .accounts import ACCOUNT_PROPERTY
from .tools import REGISTRY, Tool, ToolContext, object_schema, register

RESOURCE_URI = "ui://epic-stocks/portfolio-v1.html"
MIME_TYPE = "text/html;profile=mcp-app"
VIEWS = {"summary": "get_dashboard", "grants": "list_grants", "loans": "list_loans", "events": "list_events"}


def resource_descriptor() -> dict:
    return {"uri": RESOURCE_URI, "name": "epic-stocks-portfolio", "title": "Epic Stocks portfolio", "mimeType": MIME_TYPE}


def resource_contents() -> dict:
    ui = {"prefersBorder": True, "csp": {"connectDomains": [], "resourceDomains": []}}
    origin = os.getenv("CHATGPT_UI_ORIGIN", "")
    if origin:
        parsed = urlparse(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.username or parsed.password:
            raise ValueError("CHATGPT_UI_ORIGIN must be an HTTPS origin")
        ui["domain"] = origin.rstrip("/")
    return {
        **resource_descriptor(),
        "text": Path(__file__).with_name("portfolio.html").read_text(encoding="utf-8"),
        "_meta": {
            "ui": ui,
            "openai/ui": {"availableDisplayModes": ["inline", "fullscreen"]},
            "openai/widgetDescription": "An interactive Epic Stocks portfolio: current net equity, grants, loans and scheduled events. Projected values are labelled. The card already shows the figures; avoid repeating them all.",
        },
    }


def _read_view(ctx: ToolContext, args: dict) -> dict:
    view = args.get("view", "summary")
    if not isinstance(view, str) or view not in VIEWS:
        raise ValueError("'view' must be summary, grants, loans or events")
    if set(args) - {"view", "account", "from_date", "to_date"}:
        raise ValueError("Unknown portfolio argument")
    read_args = {"account": args.get("account", "me")}
    if view == "events":
        read_args.update({
            "from_date": (_opt_date(args, "from_date") or date.today()).isoformat(),
            "to_date": (_opt_date(args, "to_date") or (date.today() + timedelta(days=365))).isoformat(),
            "limit": 100,
        })
    elif args.get("from_date") or args.get("to_date"):
        raise ValueError("Date filters apply only to the events view")
    # The transport checks scope and starts its audit before reaching here.
    # All four underlying reads require this same scope.
    tool = REGISTRY[VIEWS[view]]
    if tool.scope not in ctx.connector.scopes:
        raise ValueError("This view requires equity:read")
    return {"view": view, "account": "me", "as_of": date.today().isoformat(), "data": tool.handler(ctx, read_args)}


_INPUT = object_schema({
    "account": ACCOUNT_PROPERTY,
    "view": {"type": "string", "enum": list(VIEWS), "default": "summary"},
    "from_date": {"type": "string", "description": "Events only: YYYY-MM-DD. Defaults to today."},
    "to_date": {"type": "string", "description": "Events only: YYYY-MM-DD. Defaults to one year from today."},
})
_OUTPUT = object_schema({
    "view": {"type": "string", "enum": list(VIEWS)},
    "account": {"type": "string", "const": "me"},
    "as_of": {"type": "string"},
    "data": {"type": "object", "description": "Unmodified result of get_dashboard, list_grants, list_loans or list_events, selected by view."},
}, ["view", "account", "as_of", "data"])

register(Tool(
    name="show_equity",
    title="Show Epic Stocks",
    description="Open the interactive Epic Stocks portfolio in chat. Choose summary, grants, loans or events. Reads the signed-in account directly; never pass calculated balances or prices. Use this when the user wants to see or browse their stocks. Events default to the coming year, with at most 100 rows and an explicit truncation flag. Other tools remain available for analysis and separately authorized edits.",
    input_schema=_INPUT, output_schema=_OUTPUT, scope=EQUITY_READ,
    handler=_read_view,
    metadata={
        "ui": {"resourceUri": RESOURCE_URI, "visibility": ["model", "app"]},
        "openai/ui": {"entrypoints": [{"type": "global"}, {"type": "thread"}]},
        "openai/toolInvocation/invoking": "Opening your portfolio…",
        "openai/toolInvocation/invoked": "Portfolio ready",
    },
))
register(Tool(
    name="refresh_equity_view", title="Refresh portfolio view",
    description="Read a portfolio view for the component without opening another card.",
    input_schema=_INPUT, output_schema=_OUTPUT, scope=EQUITY_READ,
    handler=_read_view, metadata={"ui": {"visibility": ["app"]}},
))
