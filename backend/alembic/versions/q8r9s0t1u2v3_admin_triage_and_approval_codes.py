"""error_logs resolution and admin request approval codes

Errors are resolved rather than deleted, so a fixed exception keeps its
traceback and stops showing in the admin connector's scan. Admin change
requests gain an out-of-band approval code (stored as a keyed hash only).

Revision ID: q8r9s0t1u2v3
Revises: p7q8r9s0t1u2
Create Date: 2026-11-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'q8r9s0t1u2v3'
down_revision: Union[str, Sequence[str], None] = 'p7q8r9s0t1u2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('error_logs') as batch:
        batch.add_column(sa.Column('resolved_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('resolved_by', sa.String(), nullable=True))
        batch.add_column(sa.Column('resolved_note', sa.String(), nullable=True))
    with op.batch_alter_table('admin_action_requests') as batch:
        batch.add_column(sa.Column('approval_code_hash', sa.String(), nullable=True))
        batch.add_column(sa.Column('approval_code_expires_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('approval_attempts', sa.Integer(), nullable=False, server_default='0'))
        batch.add_column(sa.Column('approval_codes_sent', sa.Integer(), nullable=False, server_default='0'))


def downgrade() -> None:
    with op.batch_alter_table('admin_action_requests') as batch:
        for name in ('approval_codes_sent', 'approval_attempts', 'approval_code_expires_at', 'approval_code_hash'):
            batch.drop_column(name)
    with op.batch_alter_table('error_logs') as batch:
        for name in ('resolved_note', 'resolved_by', 'resolved_at'):
            batch.drop_column(name)
