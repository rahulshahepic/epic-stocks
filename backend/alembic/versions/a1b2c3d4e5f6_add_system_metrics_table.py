"""add system_metrics table

Revision ID: a1b2c3d4e5f6
Revises: 28bf5e70081c
Create Date: 2026-03-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '28bf5e70081c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'system_metrics',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('cpu_percent', sa.Float(), nullable=False),
        sa.Column('ram_used_mb', sa.Float(), nullable=False),
        sa.Column('ram_total_mb', sa.Float(), nullable=False),
        sa.Column('db_size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('error_log_count', sa.Integer(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_system_metrics_timestamp'), 'system_metrics', ['timestamp'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_system_metrics_timestamp'), table_name='system_metrics')
    op.drop_table('system_metrics')
