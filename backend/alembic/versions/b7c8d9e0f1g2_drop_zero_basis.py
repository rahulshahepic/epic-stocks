"""drop grant_templates.zero_basis

The flag was redundant: tax-loan generation in the import wizard already keys
off the user-entered cost basis (price == 0 means taxable as ordinary income
at vest), and Free grants are pinned to $0 by the wizard anyway. Carrying a
separate boolean was a second source of truth that drifted from the user's
entered price; deleting it removes the bug class entirely.

Revision ID: b7c8d9e0f1g2
Revises: a6b7c8d9e0f1
Create Date: 2026-05-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c8d9e0f1g2'
down_revision: Union[str, Sequence[str], None] = 'a6b7c8d9e0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('grant_templates') as batch:
        batch.drop_column('zero_basis')


def downgrade() -> None:
    with op.batch_alter_table('grant_templates') as batch:
        batch.add_column(
            sa.Column('zero_basis', sa.Boolean(), nullable=False, server_default='0'),
        )
