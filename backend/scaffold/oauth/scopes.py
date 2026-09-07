"""What a connector may ask for.

Reads, plus two permissions that write. `import:propose` is not quite one: it
lets an assistant prepare an import and leave it for the user to review, but
writes no grant, price or loan — it stages a proposal that the wizard picks up,
and the user accepts it there. `epic_import/` is explicit that acceptance goes
through the wizard and never a file, and that holds however the draft was
produced.

`comp:write` is a real write, and is deliberately the *only* one. It covers
salary and bonus history and the retirement simulator's inputs — figures the
user types by hand, which nothing else computes from and which no other figure
is derived from. Equity stays read-only: a grant or a price feeds core.py, and
a wrong one there silently restates someone's whole timeline, which is why
entering equity goes through `import:propose` and the wizard instead.

The remaining write scopes are named here and advertised in the metadata
document, but are not grantable until the tools behind them exist — a connector
that asks for one is told so rather than silently given less than it asked for.
"""

EQUITY_READ = "equity:read"
COMP_READ = "comp:read"
COMP_WRITE = "comp:write"
IMPORT_PROPOSE = "import:propose"

# Grantable today.
SUPPORTED_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ, COMP_WRITE, IMPORT_PROPOSE)

# Scopes that let a connector leave something behind. The consent screen must
# stop calling the connection read-only once one is granted.
WRITING_SCOPES: frozenset[str] = frozenset({COMP_WRITE, IMPORT_PROPOSE})

# Of those, the ones that change stored data the moment the tool runs.
# `import:propose` only stages a draft the user accepts in the wizard, which is
# a materially different promise — and the consent screen is the one place a
# user is entitled to rely on being told which of the two they are agreeing to.
IMMEDIATE_WRITE_SCOPES: frozenset[str] = frozenset({COMP_WRITE})

# Named but not yet grantable. Kept visible so the shape of the eventual
# consent screen is public, and so a client that requests one gets a clear
# "not yet" rather than a bare invalid_scope.
RESERVED_SCOPES: tuple[str, ...] = ("equity:write", "shared:read")

# What a client that names no scope gets. Deliberately the reads only: most MCP
# clients do not narrow, and nothing that leaves a trace should arrive by
# default.
DEFAULT_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ)

SCOPE_LABELS: dict[str, str] = {
    EQUITY_READ: "Read your equity — grants, vesting, prices, loans, sales and tax estimates",
    COMP_READ: "Read your salary and retirement settings",
    COMP_WRITE: "Update your salary and bonus history and your retirement account balances",
    IMPORT_PROPOSE: "Prepare an import for you to review — it cannot change your data",
}


def writes_anything(scopes: list[str] | tuple[str, ...]) -> bool:
    return any(s in WRITING_SCOPES for s in scopes)


def writes_directly(scopes: list[str] | tuple[str, ...]) -> bool:
    """Whether anything granted here changes stored data without a review step."""
    return any(s in IMMEDIATE_WRITE_SCOPES for s in scopes)


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
