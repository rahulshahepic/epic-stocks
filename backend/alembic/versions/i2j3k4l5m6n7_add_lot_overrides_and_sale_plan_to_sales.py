"""add lot_overrides and sale plan fields to sales

Revision ID: i2j3k4l5m6n7
Revises: h1i2j3k4l5m6
Create Date: 2026-04-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'i2j3k4l5m6n7'
down_revision: Union[str, Sequence[str], None] = 'h1i2j3k4l5m6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Manual lot overrides: list of {vest_date, grant_year, grant_type, basis_price, shares}
    op.add_column('sales', sa.Column('lot_overrides', sa.JSON(), nullable=True))
    # Groups related sales in a plan (e.g. payoff + cash-out from one decision)
    op.add_column('sales', sa.Column('sale_plan_id', sa.Integer(), nullable=True))
    # User-recorded actual tax paid (overrides estimated tax for past recorded sales)
    op.add_column('sales', sa.Column('actual_tax_paid', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('sales', 'actual_tax_paid')
    op.drop_column('sales', 'sale_plan_id')
    op.drop_column('sales', 'lot_overrides')
