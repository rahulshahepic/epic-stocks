"""add content admin role and flexible payoff column

Adds:
  - users.is_content_admin (persistent, unlike is_admin which is derived from env)
  - grant_program_settings.flexible_payoff_enabled (moved from system_settings)

The old system_settings row with key='flexible_payoff_enabled' is left intact
for one release and will be cleaned up in a follow-up migration.

Revision ID: r7s8t9u0v1w2
Revises: q1r2s3t4u5v6
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'r7s8t9u0v1w2'
down_revision: Union[str, Sequence[str], None] = 'q1r2s3t4u5v6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('is_content_admin', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'grant_program_settings',
        sa.Column('flexible_payoff_enabled', sa.Boolean(), nullable=False, server_default='0'),
    )

    # Migrate any existing flexible_payoff_enabled value from system_settings
    # onto the singleton grant_program_settings row (id=1).
    conn = op.get_bind()
    existing = conn.execute(
        sa.text("SELECT value FROM system_settings WHERE key = 'flexible_payoff_enabled'")
    ).scalar()
    if existing is not None:
        truthy = str(existing).strip().lower() == "true"
        conn.execute(
            sa.text("UPDATE grant_program_settings SET flexible_payoff_enabled = :v WHERE id = 1"),
            {"v": truthy},
        )


def downgrade() -> None:
    op.drop_column('grant_program_settings', 'flexible_payoff_enabled')
    op.drop_column('users', 'is_content_admin')
