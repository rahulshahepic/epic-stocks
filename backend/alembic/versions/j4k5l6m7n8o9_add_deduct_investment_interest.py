"""add deduct_investment_interest to tax_settings

Revision ID: j4k5l6m7n8o9
Revises: h1i2j3k4l5m6
Create Date: 2026-04-03 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'j4k5l6m7n8o9'
down_revision: Union[str, Sequence[str], None] = 'h1i2j3k4l5m6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tax_settings', sa.Column('deduct_investment_interest', sa.Boolean(), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('tax_settings', 'deduct_investment_interest')
