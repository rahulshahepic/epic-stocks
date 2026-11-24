"""Whose data a tool reads.

Own account only today. The seam exists now, and every tool goes through it,
so adding shared accounts later is an additive change rather than a refactor of
eleven handlers.

The hard part of that extension is already solved elsewhere: reading another
person's rows needs *their* data key in the encryption context, not the
caller's, and `sharing.py:_get_shared_owner` does exactly that — it fetches the
owner's `encrypted_key` by raw SQL so no TypeDecorator runs with the wrong key,
switches the context, then loads the row. Supporting `account: "<invitation
id>"` here means checking the same accepted-invitation guard and delegating to
it. No tool signature changes, no token changes, no migration.
"""
from sqlalchemy.orm import Session

from scaffold.models import User

ME = "me"


def resolve_account(user: User, ref: str | None, db: Session) -> User:
    """The active financial account selected by the transport.

    Raises ValueError for anything unsupported — the transport turns that into
    a tool error the model can read and explain, rather than a protocol fault.
    """
    if ref in (None, "", ME):
        from scaffold.synthetic_accounts import requires_synthetic
        if requires_synthetic() and not user.is_synthetic:
            raise ValueError("Staging financial access requires setup_test_account; actual accounts are never accessible.")
        return user
    raise ValueError(
        f"Unknown account '{ref}'. This connection can only read your own data; "
        f"the only accepted value is '{ME}'."
    )


ACCOUNT_PROPERTY = {
    "type": "string",
    "description": (
        "Active financial account: the provisioned fixture in staging, or the signed-in account elsewhere. Only 'me' is supported; "
        "omit it."
    ),
    "default": ME,
}
