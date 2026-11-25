"""The tool registry.

A tool is its schema, the scope it needs, and a handler. Handlers call the same
service functions the HTTP routers call — the shared-view helpers in
app/routers/, which already take an arbitrary user because sharing needed that
first. Nothing here re-implements event computation and core.py is untouched.

Results go back as a JSON text block. UI tools additionally declare an output
schema and return structuredContent for the component; ordinary analysis tools
keep their existing text behavior.
"""
import json
from dataclasses import dataclass, field
from typing import Any, Callable

from sqlalchemy.orm import Session

from scaffold.oauth.resource import Connector
from scaffold.auth import get_admin_emails
from scaffold.oauth.scopes import ADMIN_SCOPES


@dataclass
class ToolContext:
    """What a handler is given: who is asking, and a session to ask with."""

    connector: Connector
    db: Session
    extra_content: list[dict] = field(default_factory=list)
    active_user: Any = None

    @property
    def user(self):
        return self.active_user if self.active_user is not None else self.connector.user


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    input_schema: dict[str, Any]
    scope: str | None
    handler: Callable[[ToolContext, dict], Any]
    # MCP annotations describe actual effects. Public financial writers use
    # conservative destructive hints so hosts can confirm saved modifications.
    read_only: bool = True
    idempotent: bool = True
    destructive: bool = False
    metadata: dict[str, Any] | None = None
    output_schema: dict[str, Any] | None = None
    blocking_io: bool = False
    staging_only: bool = False

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema,
            **({"_meta": self.metadata} if self.metadata else {}),
            **({"outputSchema": self.output_schema} if self.output_schema else {}),
            "annotations": {
                "readOnlyHint": self.read_only,
                "idempotentHint": self.idempotent,
                "openWorldHint": False,
                # Only meaningful for a tool that writes; a client shows it to
                # decide how loudly to confirm.
                **({} if self.read_only else {"destructiveHint": self.destructive}),
            },
        }


REGISTRY: dict[str, Tool] = {}


def register(tool: Tool) -> Tool:
    REGISTRY[tool.name] = tool
    return tool


def visible_to(connector: Connector) -> list[Tool]:
    """Only the tools this connection was actually granted.

    Listing a tool the caller may not call wastes a round trip and invites the
    model to promise the user something it cannot deliver.
    """
    admin = not connector.user.is_synthetic and connector.user.email.lower() in get_admin_emails()
    from scaffold.synthetic_accounts import is_staging
    from scaffold.reviewers import identity as reviewer_identity
    return [t for t in REGISTRY.values()
            if (t.scope is None or t.scope in connector.scopes)
            and (not t.staging_only or (is_staging() and not reviewer_identity(connector.user)))
            and (t.scope not in ADMIN_SCOPES or admin)]


def as_result(payload: Any) -> dict:
    """Wrap a handler's return value as an MCP tool result."""
    return {
        "content": [{
            "type": "text",
            "text": json.dumps(payload, default=str, ensure_ascii=False),
        }],
    }


def object_schema(properties: dict[str, Any], required: list[str] | None = None) -> dict:
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }
