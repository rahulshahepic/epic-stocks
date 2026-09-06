"""The tool registry.

A tool is its schema, the scope it needs, and a handler. Handlers call the same
service functions the HTTP routers call — the shared-view helpers in
app/routers/, which already take an arbitrary user because sharing needed that
first. Nothing here re-implements event computation and core.py is untouched.

Results go back as a JSON text block. Every assistant reads that; only some
read `structuredContent`, and declaring an output schema for eleven differently
shaped payloads buys nothing the model cannot already parse.
"""
import json
from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy.orm import Session

from scaffold.oauth.resource import Connector


@dataclass
class ToolContext:
    """What a handler is given: who is asking, and a session to ask with."""

    connector: Connector
    db: Session

    @property
    def user(self):
        return self.connector.user


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    input_schema: dict[str, Any]
    scope: str
    handler: Callable[[ToolContext, dict], Any]
    # MCP tool annotations. Read-only is the honest value for every tool in this
    # release, and it is what lets a client show them without a confirmation.
    read_only: bool = True
    idempotent: bool = True

    def describe(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema,
            "annotations": {
                "readOnlyHint": self.read_only,
                "idempotentHint": self.idempotent,
                "openWorldHint": False,
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
    return [t for t in REGISTRY.values() if t.scope in connector.scopes]


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
