"""Encrypt sales.shares and sales.lot_overrides

Both were plaintext while every other financial column on the table was
encrypted. shares is a holding size, and lot_overrides holds
[{vest_date, grant_year, grant_type, basis_price, shares}, ...] — per-share
basis prices and share counts, the same data price_per_share is encrypted to
protect. Anyone reading the table saw the position and its cost basis.

Converts both columns to VARCHAR/TEXT so EncryptedInt and EncryptedJSON can
store AES-256-GCM ciphertext. Existing rows stay plaintext after this runs and
are re-encrypted in place by backfill_plaintext_encryption() on the next boot;
they read correctly in the meantime because the decorators pass through any
value without the $ENC$ prefix.

Revision ID: a2b3c4d5e6f7
Revises: e1f2a3b4c5d6
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        # SQLite test environments use create_all and skip migrations entirely.
        return

    op.execute(
        "ALTER TABLE sales "
        "ALTER COLUMN shares TYPE VARCHAR "
        "USING shares::text"
    )
    op.execute(
        "ALTER TABLE sales "
        "ALTER COLUMN lot_overrides TYPE TEXT "
        "USING lot_overrides::text"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'postgresql':
        return

    # Only safe before encryption has been applied: $ENC$-prefixed values
    # cannot be cast back to INTEGER or JSON.
    op.execute(
        "ALTER TABLE sales "
        "ALTER COLUMN lot_overrides TYPE JSON "
        "USING lot_overrides::json"
    )
    op.execute(
        "ALTER TABLE sales "
        "ALTER COLUMN shares TYPE INTEGER "
        "USING shares::integer"
    )
