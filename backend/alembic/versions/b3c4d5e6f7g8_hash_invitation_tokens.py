"""Replace plaintext invitation tokens with HMAC verifiers

invitations.token and invitations.short_code held the secrets themselves, so
anyone who could read the table could redeem every pending invitation — and
acceptance does not require the accepting account's email to match the one
invited, so a stolen token works from any signed-in account.

Both columns now hold an HMAC-SHA256 verifier keyed on INVITE_TOKEN_SECRET
(or JWT_SECRET). short_code_sealed is added alongside, holding the code
encrypted under the same server-held key, because the sent-invitations list
shows the inviter their code — the token has no equivalent, it is never
displayed.

Existing pending rows are converted in place: their plaintext values are read,
hashed, and the code is sealed. This is the last moment those values exist, so
the conversion cannot be re-run. Rows that are already accepted, revoked or
declined are converted too — their secrets are no longer redeemable, but there
is no reason to leave them lying in plaintext.

Revision ID: b3c4d5e6f7g8
Revises: a2b3c4d5e6f7
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b3c4d5e6f7g8'
down_revision: Union[str, Sequence[str], None] = 'a2b3c4d5e6f7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        # SQLite test environments use create_all and skip migrations entirely.
        return

    op.add_column('invitations', sa.Column('short_code_sealed', sa.String(), nullable=True))

    # Imported here, not at module scope: alembic imports every revision file
    # at startup, and this pulls in the app package.
    from scaffold.invite_tokens import code_verifier, seal_code, token_verifier

    rows = bind.execute(
        sa.text("SELECT id, token, short_code FROM invitations")
    ).fetchall()

    for inv_id, token, short_code in rows:
        bind.execute(
            sa.text(
                "UPDATE invitations SET token = :t, short_code = :c,"
                " short_code_sealed = :s WHERE id = :id"
            ),
            {
                "t": token_verifier(token) if token else token,
                "c": code_verifier(short_code) if short_code else short_code,
                "s": seal_code(short_code) if short_code else None,
                "id": inv_id,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        return

    # The plaintext token is not recoverable from its verifier. The short code
    # is, from the sealed copy; the token is not, so every invitation has to be
    # revoked and re-sent after a downgrade.
    op.drop_column('invitations', 'short_code_sealed')
