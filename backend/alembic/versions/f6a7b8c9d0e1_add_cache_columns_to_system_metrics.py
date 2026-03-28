"""add cache columns to system_metrics

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, Sequence[str], None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('system_metrics', sa.Column('cache_l1_hits', sa.Integer(), nullable=True))
    op.add_column('system_metrics', sa.Column('cache_l2_hits', sa.Integer(), nullable=True))
    op.add_column('system_metrics', sa.Column('cache_misses', sa.Integer(), nullable=True))
    op.add_column('system_metrics', sa.Column('cache_l2_key_count', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('system_metrics', 'cache_l2_key_count')
    op.drop_column('system_metrics', 'cache_misses')
    op.drop_column('system_metrics', 'cache_l2_hits')
    op.drop_column('system_metrics', 'cache_l1_hits')
