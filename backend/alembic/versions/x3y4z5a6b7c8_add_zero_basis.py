"""add grant_templates.zero_basis

Whether grants issued from a template have $0 cost basis (zero-basis
RSUs/bonuses taxable at vest) was previously inferred from the user-entered
purchase price at wizard time — i.e. a per-user runtime check. Moving that
decision onto the template so it's company-wide policy and the admin can
configure per (year, type) whether a Bonus/Free grant is zero-basis or FMV.

Backfill: True for Bonus/Free rows (always zero-basis in Epic's program
history), False for Purchase rows.

Revision ID: x3y4z5a6b7c8
Revises: w2x3y4z5a6b7
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'x3y4z5a6b7c8'
down_revision: Union[str, Sequence[str], None] = 'w2x3y4z5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'grant_templates',
        sa.Column('zero_basis', sa.Boolean(), nullable=False, server_default='0'),
    )
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE grant_templates SET zero_basis = 1 WHERE type IN ('Bonus', 'Free')"
    ))


def downgrade() -> None:
    with op.batch_alter_table('grant_templates') as batch:
        batch.drop_column('zero_basis')
