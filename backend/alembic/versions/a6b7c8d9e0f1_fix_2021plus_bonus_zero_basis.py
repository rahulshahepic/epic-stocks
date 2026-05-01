"""fix zero_basis on 2021+ Bonus grant templates

The original `add_zero_basis` migration backfilled `zero_basis=True` for all
Bonus and Free templates. That was correct for 2020 Bonus and 2022 Free, but
Epic's 2021-onward Bonus grants are issued with a non-zero cost basis, so they
do NOT generate ordinary-income tax loans at vest. This migration corrects the
flag (and clears the now-irrelevant default_tax_due_date) for those rows.

Revision ID: a6b7c8d9e0f1
Revises: z5a6b7c8d9e0
Create Date: 2026-05-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a6b7c8d9e0f1'
down_revision: Union[str, Sequence[str], None] = 'z5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE grant_templates "
            "SET zero_basis = :zb, default_tax_due_date = NULL "
            "WHERE type = 'Bonus' AND year >= 2021"
        ),
        {"zb": False},
    )


def downgrade() -> None:
    # No-op: we don't restore the incorrect flag.
    pass
