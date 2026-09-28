"""What a connector may ask for.

Reads, plus separate permissions for proposing imports and writing data. `import:propose` is not quite a write: it
lets an assistant prepare an import and leave it for the user to review, but
writes no grant, price or loan — it stages a proposal that the wizard picks up,
and the user accepts it there. `epic_import/` is explicit that acceptance goes
through the wizard and never a file, and that holds however the draft was
produced.

`comp:write` changes salary, bonus and retirement inputs. `equity:write` is
separate and changes individual equity rows through the app's validated CRUD
paths, only when explicitly granted. Neither is in the default scopes.

The remaining write scopes are named here and advertised in the metadata
document, but are not grantable until the tools behind them exist — a connector
that asks for one is told so rather than silently given less than it asked for.
"""

EQUITY_READ = "equity:read"
COMP_READ = "comp:read"
COMP_WRITE = "comp:write"
IMPORT_PROPOSE = "import:propose"
EQUITY_WRITE = "equity:write"

# Grantable today.
SUPPORTED_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ, COMP_WRITE, IMPORT_PROPOSE, EQUITY_WRITE)

# Scopes that let a connector leave something behind. The consent screen must
# stop calling the connection read-only once one is granted.
WRITING_SCOPES: frozenset[str] = frozenset({COMP_WRITE, IMPORT_PROPOSE, EQUITY_WRITE})

# Of those, the ones that change stored data the moment the tool runs.
# `import:propose` only stages a draft the user accepts in the wizard.
IMMEDIATE_WRITE_SCOPES: frozenset[str] = frozenset({COMP_WRITE, EQUITY_WRITE})

# Named but not yet grantable. Kept visible so the shape of the eventual
# consent screen is public, and so a client that requests one gets a clear
# "not yet" rather than a bare invalid_scope.
RESERVED_SCOPES: tuple[str, ...] = ("shared:read",)

# What a client that names no scope gets. Deliberately the reads only: most MCP
# clients do not narrow, and nothing that leaves a trace should arrive by
# default.
DEFAULT_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ)

SCOPE_LABELS: dict[str, str] = {
    EQUITY_READ: "Read your equity — grants, vesting, prices, loans, sales and tax estimates",
    COMP_READ: "Read your salary and retirement settings",
    COMP_WRITE: "Update your salary and bonus history and your retirement account balances",
    IMPORT_PROPOSE: "Prepare an import for you to review — it cannot change your data",
    EQUITY_WRITE: "Create, correct or remove your grants, prices, loans and sales directly",
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
                f"The scope '{scope}' is not available yet"
            )
        if scope not in SUPPORTED_SCOPES:
            raise ScopeError(f"Unknown scope '{scope}'")
        seen.append(scope)
    if not seen:
        raise ScopeError("No usable scope was requested")
    if EQUITY_WRITE in seen and EQUITY_READ not in seen:
        raise ScopeError("equity:write also requires equity:read to verify existing rows")
    return seen


def format_scope(scopes: list[str] | tuple[str, ...]) -> str:
    return " ".join(scopes)


def has_scope(granted: str, needed: str) -> bool:
    return needed in granted.split()
