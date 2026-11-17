"""admin_action_requests and admin_action_journal: AI-requested changes awaiting approval, and a record of admin changes

The admin MCP gains `admin:write`. Changes that would let more assistants
connect are never made by a tool call; they are filed here and approved in the
browser admin page.

Revision ID: p7q8r9s0t1u2
Revises: o6p7q8r9s0t1
Create Date: 2026-11-17 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'p7q8r9s0t1u2'
down_revision: Union[str, Sequence[str], None] = 'o6p7q8r9s0t1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'admin_action_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('payload', sa.String(), nullable=False),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='pending'),
        sa.Column('client_name', sa.String(), nullable=True),
        sa.Column('grant_id', sa.Integer(), nullable=True),
        sa.Column('outcome', sa.String(), nullable=True),
        sa.Column('decided_by', sa.String(), nullable=True),
        sa.Column('requested_at', sa.DateTime(), nullable=True),
        sa.Column('decided_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_admin_action_requests_status', 'admin_action_requests', ['status'])

    op.create_table(
        'admin_action_journal',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('at', sa.DateTime(), nullable=True),
        sa.Column('environment', sa.String(), nullable=True),
        sa.Column('via', sa.String(), nullable=False),
        sa.Column('actor_email', sa.String(), nullable=True),
        sa.Column('grant_id', sa.Integer(), nullable=True),
        sa.Column('client_name', sa.String(), nullable=True),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('target_type', sa.String(), nullable=True),
        sa.Column('target_id', sa.Integer(), nullable=True),
        sa.Column('request_id', sa.Integer(), nullable=True),
        sa.Column('before', sa.String(), nullable=True),
        sa.Column('after', sa.String(), nullable=True),
        sa.Column('outcome', sa.String(), nullable=False, server_default='started'),
        sa.Column('detail', sa.String(), nullable=True),
    )
    op.create_index('ix_admin_action_journal_at', 'admin_action_journal', ['at'])
    op.create_index('ix_admin_action_journal_action', 'admin_action_journal', ['action'])


def downgrade() -> None:
    op.drop_index('ix_admin_action_journal_action', table_name='admin_action_journal')
    op.drop_index('ix_admin_action_journal_at', table_name='admin_action_journal')
    op.drop_table('admin_action_journal')
    op.drop_index('ix_admin_action_requests_status', table_name='admin_action_requests')
    op.drop_table('admin_action_requests')
