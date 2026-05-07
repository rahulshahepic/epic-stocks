"""add user profile + simulator/dashboard preferences

Adds three nullable columns to users:
  - date_of_birth: drives "current age" on the Retirement Simulator
  - retirement_params: encrypted JSON blob of last-saved sim params
  - dashboard_prefs: JSON blob of dashboard view state (date mode, etc.)

Revision ID: c8d9e0f1g2h3
Revises: b7c8d9e0f1g2
Create Date: 2026-05-07 02:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8d9e0f1g2h3'
down_revision: Union[str, Sequence[str], None] = 'b7c8d9e0f1g2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('date_of_birth', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('retirement_params', sa.JSON(), nullable=True))
    op.add_column('users', sa.Column('dashboard_prefs', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'dashboard_prefs')
    op.drop_column('users', 'retirement_params')
    op.drop_column('users', 'date_of_birth')
