"""Namespace provider_sub by provider to prevent cross-IdP account takeover

Adds users.provider_name so the identity lookup key is (provider_name, google_id)
instead of google_id alone. Existing rows are backfilled as 'google'. The old
unique index on google_id alone is replaced with a compound unique constraint.

Revision ID: a6b7c8d9e0f1
Revises: z5a6b7c8d9e0
Create Date: 2026-05-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a6b7c8d9e0f1'
down_revision: Union[str, Sequence[str], None] = 'z5a6b7c8d9e0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add provider_name as nullable so the backfill can run first
    op.add_column('users', sa.Column('provider_name', sa.String(), nullable=True))
    op.execute("UPDATE users SET provider_name = 'google' WHERE provider_name IS NULL")
    # Make non-nullable now that all rows have a value
    op.alter_column('users', 'provider_name', existing_type=sa.String(), nullable=False)
    # Drop the old unique index on google_id alone, add compound unique constraint
    op.drop_index('ix_users_google_id', table_name='users')
    op.create_unique_constraint('uq_users_provider_sub', 'users', ['provider_name', 'google_id'])
    op.create_index(op.f('ix_users_google_id'), 'users', ['google_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_users_google_id'), table_name='users')
    op.drop_constraint('uq_users_provider_sub', 'users', type_='unique')
    op.create_index(op.f('ix_users_google_id'), 'users', ['google_id'], unique=True)
    op.drop_column('users', 'provider_name')
