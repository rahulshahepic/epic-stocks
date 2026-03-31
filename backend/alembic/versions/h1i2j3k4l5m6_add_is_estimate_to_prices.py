"""add is_estimate to prices

Revision ID: h1i2j3k4l5m6
Revises: g8h9i0j1k2l3
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h1i2j3k4l5m6'
down_revision: Union[str, Sequence[str], None] = 'g8h9i0j1k2l3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('prices', sa.Column('is_estimate', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('prices', 'is_estimate')
