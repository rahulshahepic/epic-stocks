"""What a connector may ask for.

Read-only for now. The write scopes are named here and advertised in the
metadata document, but are not grantable until the tools behind them exist —
a connector that asks for one is told so rather than silently given less than
it asked for.
"""

EQUITY_READ = "equity:read"
COMP_READ = "comp:read"

# Grantable today.
SUPPORTED_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ)

# Named but not yet grantable. Kept visible so the shape of the eventual
# consent screen is public, and so a client that requests one gets a clear
# "not yet" rather than a bare invalid_scope.
RESERVED_SCOPES: tuple[str, ...] = ("equity:write", "comp:write", "shared:read")

DEFAULT_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ)

SCOPE_LABELS: dict[str, str] = {
    EQUITY_READ: "Read your equity — grants, vesting, prices, loans, sales and tax estimates",
    COMP_READ: "Read your salary and retirement settings",
}


class ScopeError(ValueError):
    """A requested scope cannot be granted. The message reaches the client."""


def parse_scope(raw: str | None) -> list[str]:
    """Space-delimited scope string to a validated, de-duplicated list.

    An empty or missing request means the default set, which is what most MCP
    clients send — they discover scopes from the metadata document and often
    do not narrow them.
    """
    if not raw or not raw.strip():
        return list(DEFAULT_SCOPES)

    seen: list[str] = []
    for scope in raw.split():
        if scope in seen:
            continue
        if scope in RESERVED_SCOPES:
            raise ScopeError(
                f"The scope '{scope}' is not available yet — this connector is read-only"
            )
        if scope not in SUPPORTED_SCOPES:
            raise ScopeError(f"Unknown scope '{scope}'")
        seen.append(scope)
    if not seen:
        raise ScopeError("No usable scope was requested")
    return seen


def format_scope(scopes: list[str] | tuple[str, ...]) -> str:
    return " ".join(scopes)


def has_scope(granted: str, needed: str) -> bool:
    return needed in granted.split()
