"""add sales.is_generated

Marks a payoff sale the app computed, as opposed to one the user entered or
edited. `_regenerate_future_payoff_sales` rewrites and can delete future payoff
sales whenever a loan or a loan payment changes; without this flag it could not
tell a figure it wrote itself from one the user deliberately retuned, so a
recorded payment silently discarded the user's own numbers.

Backfill: every existing row with a `loan_id` is marked generated. `notes`
carries the "Auto-generated payoff sale" marker the app writes, but it is an
EncryptedString, so no SQL predicate can read it. Marking them all reproduces
exactly today's behaviour for rows already on file — every one of them is
regenerable now — while anything created or edited after this migration is
classified correctly. A user who edits an old hand-attached payoff sale clears
the flag on that row and it stops being rewritten from then on.

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
    op.add_column('sales', sa.Column('is_generated', sa.Boolean(), nullable=False,
                                     server_default='0'))
    op.execute("UPDATE sales SET is_generated = 1 WHERE loan_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column('sales', 'is_generated')
