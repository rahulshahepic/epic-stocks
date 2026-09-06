"""add mcp_audit

`oauth_grants.last_used_at` was the only trace an AI connection left, and it is
one timestamp overwritten on every request — it says a connection was used, not
what it read. For a feature whose whole purpose is sending someone's financial
figures to an outside company, that is not enough for the user (did my
assistant read my salary, or only my vesting dates?) or for whoever has to look
into a report later.

No financial data in this table, ever: tool names and scopes, never arguments,
figures or results. Same rule as user_reports, for the same reason.

grant_id carries no foreign key deliberately — disconnecting deletes the grant,
and the record of what that connection did has to outlive it.

Revision ID: f7g8h9i0j1k2
Revises: e6f7g8h9i0j1
Create Date: 2026-09-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f7g8h9i0j1k2'
down_revision: Union[str, Sequence[str], None] = 'e6f7g8h9i0j1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mcp_audit',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('grant_id', sa.Integer(), nullable=True),
        sa.Column('client_name', sa.String(), nullable=False, server_default=''),
        sa.Column('event', sa.String(), nullable=False),
        sa.Column('tool', sa.String(), nullable=True),
        sa.Column('scope', sa.String(), nullable=True),
        sa.Column('outcome', sa.String(), nullable=False, server_default='pending'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_mcp_audit_user_id', 'mcp_audit', ['user_id'])
    op.create_index('ix_mcp_audit_grant_id', 'mcp_audit', ['grant_id'])
    op.create_index('ix_mcp_audit_event', 'mcp_audit', ['event'])
    op.create_index('ix_mcp_audit_tool', 'mcp_audit', ['tool'])
    op.create_index('ix_mcp_audit_created_at', 'mcp_audit', ['created_at'])


def downgrade() -> None:
    op.drop_table('mcp_audit')
