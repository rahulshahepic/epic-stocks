"""What a connector may ask for.

Reads, plus separate permissions for writing data. `comp:write` changes salary,
bonus and retirement inputs. `equity:write` is apply_changes: a change set the
assistant previews, shows the person, and applies with the preview's token.

`import:propose` staged a draft for a review wizard that no longer exists. It is
still accepted from a client that asks for it, so older connectors keep
working, but it is no longer offered or granted by default and no tool needs it. The consent screen offers each account
permission separately, with the requested permissions initially selected.

The remaining write scopes are named here and advertised in the metadata
document, but are not grantable until the tools behind them exist — a connector
that asks for one is told so rather than silently given less than it asked for.
"""

EQUITY_READ = "equity:read"
COMP_READ = "comp:read"
COMP_WRITE = "comp:write"
IMPORT_PROPOSE = "import:propose"
EQUITY_WRITE = "equity:write"
ADMIN_READ = "admin:read"
ADMIN_WRITE = "admin:write"

# Grantable today.
SUPPORTED_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ, COMP_WRITE, IMPORT_PROPOSE, EQUITY_WRITE)
ADMIN_SCOPES: tuple[str, ...] = (ADMIN_READ, ADMIN_WRITE)
# What an admin connection gets when it names nothing: diagnostics only.
# Writing is a separate tick on the admin consent page.
ADMIN_DEFAULT_SCOPES: tuple[str, ...] = (ADMIN_READ,)

# Scopes that let a connector leave something behind. The consent screen must
# stop calling the connection read-only once one is granted.
WRITING_SCOPES: frozenset[str] = frozenset({COMP_WRITE, IMPORT_PROPOSE, EQUITY_WRITE, ADMIN_WRITE})

# Of those, the ones that change stored data.
IMMEDIATE_WRITE_SCOPES: frozenset[str] = frozenset({COMP_WRITE, EQUITY_WRITE})

# Named but not yet grantable. Kept visible so the shape of the eventual
# consent screen is public, and so a client that requests one gets a clear
# "not yet" rather than a bare invalid_scope.
RESERVED_SCOPES: tuple[str, ...] = ("shared:read",)

# What a client that names no scope gets: ordinary account permissions. ChatGPT
# names none, and a read-only default left people unable to find how to edit.
# Site diagnostics require a separate action on the consent page.
# The app is not the source of truth for anyone's equity — a wrong row is fixed
# by editing it or re-importing — so the consent screen lists what is granted
# and that is the check.
DEFAULT_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ, COMP_WRITE, EQUITY_WRITE)

SCOPE_LABELS: dict[str, str] = {
    EQUITY_READ: "Read your equity — grants, vesting, prices, loans, sales and tax estimates",
    COMP_READ: "Read your salary and retirement settings",
    COMP_WRITE: "Update your salary and bonus history and your retirement account balances",
    IMPORT_PROPOSE: "Prepare an import (no longer used)",
    EQUITY_WRITE: "Add, correct or remove your grants, prices, loans and sales — shown to you first, saved when you agree",
    ADMIN_READ: "Read site deployment status, system metrics and redacted application error records",
    ADMIN_WRITE: "Change site settings: triage reports, switch AI providers off, and file requests "
                 "to widen access that you approve in Admin",
}


def is_admin_scope(scope) -> bool:
    """Whether a grant, client or code belongs to the admin MCP server.

    Takes a space-delimited scope string or a list. Admin and account scopes
    never mix in one grant, so any admin scope decides it.
    """
    parts = scope.split() if isinstance(scope, str) else list(scope or ())
    return any(s in ADMIN_SCOPES for s in parts)


def writes_anything(scopes: list[str] | tuple[str, ...]) -> bool:
    return any(s in WRITING_SCOPES for s in scopes)


def writes_directly(scopes: list[str] | tuple[str, ...]) -> bool:
    """Whether anything granted here changes stored data without a review step."""
    return any(s in IMMEDIATE_WRITE_SCOPES for s in scopes)


class ScopeError(ValueError):
    """A requested scope cannot be granted. The message reaches the client."""


def parse_scope(raw: str | None, *, admin: bool = False) -> list[str]:
    """Space-delimited scope string to a validated, de-duplicated list.

    An empty or missing request means the default set, which is what most MCP
    clients send — they discover scopes from the metadata document and often
    do not narrow them.
    """
    if not raw or not raw.strip():
        return list(ADMIN_DEFAULT_SCOPES if admin else DEFAULT_SCOPES)

    seen: list[str] = []
    for scope in raw.split():
        if scope in seen:
            continue
        if scope in RESERVED_SCOPES:
            raise ScopeError(
                f"The scope '{scope}' is not available yet"
            )
        if scope not in (ADMIN_SCOPES if admin else SUPPORTED_SCOPES):
            raise ScopeError(f"Unknown scope '{scope}'")
        seen.append(scope)
    if not seen:
        raise ScopeError("No usable scope was requested")
    if ADMIN_WRITE in seen and ADMIN_READ not in seen:
        raise ScopeError("admin:write also requires admin:read")
    if EQUITY_WRITE in seen and EQUITY_READ not in seen:
        raise ScopeError("equity:write also requires equity:read to verify existing rows")
    return seen


def format_scope(scopes: list[str] | tuple[str, ...]) -> str:
    return " ".join(scopes)


def has_scope(granted: str, needed: str) -> bool:
    return needed in granted.split()
