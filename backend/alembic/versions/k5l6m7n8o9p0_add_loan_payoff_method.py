"""add loan_payoff_method to tax_settings and flexible_payoff_enabled to system_settings

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
Create Date: 2026-04-04 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'k5l6m7n8o9p0'
down_revision: Union[str, Sequence[str], None] = 'j4k5l6m7n8o9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tax_settings', sa.Column('loan_payoff_method', sa.String(), nullable=False, server_default='epic_lifo'))
    op.execute("INSERT INTO system_settings (key, value) VALUES ('flexible_payoff_enabled', 'false') ON CONFLICT DO NOTHING")


def downgrade() -> None:
    op.drop_column('tax_settings', 'loan_payoff_method')
    op.execute("DELETE FROM system_settings WHERE key = 'flexible_payoff_enabled'")
