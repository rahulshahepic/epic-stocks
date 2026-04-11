"""add deduction_excluded_years to tax_settings

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
Create Date: 2026-04-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'm7n8o9p0q1r2'
down_revision: Union[str, Sequence[str], None] = 'l6m7n8o9p0q1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tax_settings', sa.Column('deduction_excluded_years', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('tax_settings', 'deduction_excluded_years')
