"""What a connector may ask for.

Reads, plus separate permissions for writing data. `comp:write` changes salary,
bonus and retirement inputs. `equity:write` is apply_changes: a change set the
assistant previews, shows the person, and applies with the preview's token.

`import:propose` staged a draft for a retired review wizard. Older clients
that request it alongside current permissions may still connect. It is omitted
from discovery, consent, and new grants. Existing grants continue to work.

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
ADMIN_REPORT_SENSITIVE = "admin:reports:sensitive"

# Grantable today.
SUPPORTED_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ, COMP_WRITE, EQUITY_WRITE)
ADMIN_SCOPES: tuple[str, ...] = (ADMIN_READ, ADMIN_WRITE, ADMIN_REPORT_SENSITIVE)
# What an admin connection gets when it names nothing: diagnostics only.
# Writing is a separate tick on the admin consent page.
ADMIN_DEFAULT_SCOPES: tuple[str, ...] = (ADMIN_READ,)

# Scopes that let a connector leave something behind. The consent screen must
# stop calling the connection read-only once one is granted.
WRITING_SCOPES: frozenset[str] = frozenset({COMP_WRITE, EQUITY_WRITE, ADMIN_WRITE})

# Of those, the ones that change stored data.
IMMEDIATE_WRITE_SCOPES: frozenset[str] = frozenset({COMP_WRITE, EQUITY_WRITE})

# Named but not yet grantable. Kept visible so the shape of the eventual
# consent screen is public, and so a client that requests one gets a clear
# "not yet" rather than a bare invalid_scope.
RESERVED_SCOPES: tuple[str, ...] = ("shared:read",)

# When a client names no scope, editing remains available as a consent choice.
DEFAULT_SCOPES: tuple[str, ...] = (EQUITY_READ, COMP_READ)

SCOPE_LABELS: dict[str, str] = {
    EQUITY_READ: "Read your equity — grants, vesting, prices, loans, sales and tax estimates",
    COMP_READ: "Read your salary and retirement settings",
    COMP_WRITE: "Update your salary and bonus history and your retirement account balances",
    EQUITY_WRITE: "Add, correct or remove your grants, prices, loans and sales — shown to you first, saved when you agree",
    ADMIN_READ: "Read site deployment status, system metrics and redacted application error records",
    ADMIN_REPORT_SENSITIVE: "Read support reports with separately consented identity, financial diagnostics and original documents",
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
        if scope in seen or (not admin and scope == IMPORT_PROPOSE):
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
    if ADMIN_READ not in seen:
        for extra in (ADMIN_WRITE, ADMIN_REPORT_SENSITIVE):
            if extra in seen:
                raise ScopeError(f"{extra} also requires admin:read")
    if EQUITY_WRITE in seen and EQUITY_READ not in seen:
        raise ScopeError("equity:write also requires equity:read to verify existing rows")
    return seen


def format_scope(scopes: list[str] | tuple[str, ...]) -> str:
    return " ".join(scopes)


def has_scope(granted: str, needed: str) -> bool:
    return needed in granted.split()
