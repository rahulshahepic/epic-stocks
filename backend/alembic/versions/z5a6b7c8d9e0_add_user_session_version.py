"""add users.session_version for token revocation

Bumped by the "sign out everywhere" endpoint to invalidate all outstanding
JWTs for a user. Tokens embed the version at issue time; on every request
we compare the JWT's sv claim against the user's current session_version
and reject mismatches.

Revision ID: z5a6b7c8d9e0
Revises: y4z5a6b7c8d9
Create Date: 2026-04-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'z5a6b7c8d9e0'
down_revision: Union[str, Sequence[str], None] = 'y4z5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('session_version', sa.Integer(), nullable=False, server_default='0'),
    )


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('session_version')
