"""add system_settings table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-28 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'system_settings',
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('value', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('key'),
    )
    # Seed required rows.  master_key is created on first app boot by the lifespan handler.
    op.execute("INSERT INTO system_settings (key, value) VALUES ('maintenance_active', 'false')")
    op.execute("INSERT INTO system_settings (key, value) VALUES ('master_key_version', '1')")


def downgrade() -> None:
    op.drop_table('system_settings')
