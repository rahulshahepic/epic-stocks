"""add users.comp_entries for salary/bonus per year

Stores per-year salary and bonus amounts for the total comp calculator.
Encrypted JSON blob; keys are year strings, values are {salary, bonus}.

Revision ID: a7b8c9d0e1f2
Revises: z5a6b7c8d9e0
Create Date: 2026-06-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, Sequence[str], None] = 'z5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('comp_entries', sa.String(), nullable=True),
    )


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('comp_entries')
