"""admin_action_requests: changes an admin's AI assistant asked for, awaiting approval

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


def downgrade() -> None:
    op.drop_index('ix_admin_action_requests_status', table_name='admin_action_requests')
    op.drop_table('admin_action_requests')
