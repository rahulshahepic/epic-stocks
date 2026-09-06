"""The tool registry.

A tool is its schema plus a handler plus the scope it needs. Handlers call the
same service functions the HTTP routers call — nothing here re-implements event
computation, and core.py is not touched.

Empty for now. Phase 2 registers the read tools.
"""
from dataclasses import dataclass
from typing import Any, Callable

from scaffold.oauth.resource import Connector


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    input_schema: dict[str, Any]
    scope: str
    handler: Callable[..., Any]
    # MCP tool annotations. Read-only is the honest default here: every tool in
    # the first release only reads.
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
    model to promise something it cannot deliver.
    """
    return [t for t in REGISTRY.values() if t.scope in connector.scopes]
