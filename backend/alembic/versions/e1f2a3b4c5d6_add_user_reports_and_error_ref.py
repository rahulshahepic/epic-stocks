"""add user_reports table and error_logs.error_ref

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-09-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = 'd0e1f2a3b4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('error_logs', sa.Column('error_ref', sa.String(), nullable=True))
    op.create_index(op.f('ix_error_logs_error_ref'), 'error_logs', ['error_ref'], unique=False)

    op.create_table(
        'user_reports',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('message', sa.String(), nullable=False),
        sa.Column('path', sa.String(), nullable=True),
        sa.Column('source', sa.String(), nullable=False, server_default='manual'),
        sa.Column('error_ref', sa.String(), nullable=True),
        sa.Column('error_message', sa.String(), nullable=True),
        sa.Column('include_details', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('app_version', sa.String(), nullable=True),
        sa.Column('client_log', sa.String(), nullable=True),
        sa.Column('ip_hash', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='new'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_reports_timestamp'), 'user_reports', ['timestamp'], unique=False)
    op.create_index(op.f('ix_user_reports_error_ref'), 'user_reports', ['error_ref'], unique=False)
    op.create_index(op.f('ix_user_reports_status'), 'user_reports', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_reports_status'), table_name='user_reports')
    op.drop_index(op.f('ix_user_reports_error_ref'), table_name='user_reports')
    op.drop_index(op.f('ix_user_reports_timestamp'), table_name='user_reports')
    op.drop_table('user_reports')
    op.drop_index(op.f('ix_error_logs_error_ref'), table_name='error_logs')
    op.drop_column('error_logs', 'error_ref')
