"""drop grant_type_defs table

The four grant types (Purchase / Catch-Up / Bonus / Free) and their semantics
are hard-coded everywhere — core.py, the sales engine, the import wizard, and
every test branch on those specific strings. The `grant_type_defs` table was
providing three thin fields (color_class, description, is_pre_tax_when_zero_price)
that didn't meaningfully make the list editable. Moved those constants into
backend/app/grant_types.py and frontend/src/app/grantTypes.ts.

Revision ID: v1w2x3y4z5a6
Revises: u0v1w2x3y4z5
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'v1w2x3y4z5a6'
down_revision: Union[str, Sequence[str], None] = 'u0v1w2x3y4z5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('grant_type_defs')


def downgrade() -> None:
    op.create_table(
        'grant_type_defs',
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('color_class', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=False),
        sa.Column('is_pre_tax_when_zero_price', sa.Boolean(), nullable=False, server_default='0'),
        sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='1'),
        sa.PrimaryKeyConstraint('name'),
    )
