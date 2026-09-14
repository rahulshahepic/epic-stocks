"""add sales.is_generated

Marks a payoff sale the app computed, as opposed to one the user entered or
edited. `_regenerate_future_payoff_sales` rewrites and can delete future payoff
sales whenever a loan or a loan payment changes; without this flag it could not
tell a figure it wrote itself from one the user deliberately retuned, so a
recorded payment silently discarded the user's own numbers.

Existing rows remain user-owned. Some are generated and some were manually
attached or edited, and `notes` is encrypted so the migration cannot distinguish
them safely. Misclassifying a manual row would let a later loan/payment write
rewrite or delete user data; preserving uncertain rows is the safe default.
Users can delete an old payoff sale and regenerate it if they want the app to
resume maintaining it.

Revision ID: h9i0j1k2l3m5
Revises: g8h9i0j1k2l4
Create Date: 2026-09-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h9i0j1k2l3m5'
down_revision: Union[str, Sequence[str], None] = 'g8h9i0j1k2l4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'sales',
        sa.Column('is_generated', sa.Boolean(), nullable=False,
                  server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('sales', 'is_generated')
