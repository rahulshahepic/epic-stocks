"""move AI connection settings out of the environment and into the database

MCP_ENABLED and MCP_ALLOWED_REDIRECT_HOSTS were deployment configuration, which
made "stop accepting connections from ChatGPT" a redeploy. They are policy an
admin should be able to change from the admin page, so the switch moves to
system_settings and the provider allowlist becomes a table.

Seeds the switch on, and the two products a user can actually connect from
today: ChatGPT and Claude, both enabled. Claude is two hosts under one label,
because an admin should see one thing to switch off, not two.

Revision ID: e6f7g8h9i0j1
Revises: d5e6f7g8h9i0
Create Date: 2026-09-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e6f7g8h9i0j1'
down_revision: Union[str, Sequence[str], None] = 'd5e6f7g8h9i0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEFAULT_HOSTS = [
    ('ChatGPT', 'chatgpt.com'),
    ('Claude', 'claude.ai'),
    ('Claude', 'claude.com'),
]


def upgrade() -> None:
    hosts = op.create_table(
        'oauth_redirect_hosts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('host', sa.String(), nullable=False),
        sa.Column('enabled', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_oauth_redirect_hosts_host', 'oauth_redirect_hosts', ['host'], unique=True)

    op.bulk_insert(hosts, [
        {'label': label, 'host': host, 'enabled': 1}
        for label, host in DEFAULT_HOSTS
    ])

    # The master switch, on. Written only if absent, so re-running against a
    # database an admin has already touched does not turn the feature back on
    # behind their back.
    op.execute(
        "INSERT INTO system_settings (key, value) "
        "SELECT 'mcp_enabled', 'true' "
        "WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'mcp_enabled')"
    )


def downgrade() -> None:
    op.execute("DELETE FROM system_settings WHERE key = 'mcp_enabled'")
    op.drop_index('ix_oauth_redirect_hosts_host', table_name='oauth_redirect_hosts')
    op.drop_table('oauth_redirect_hosts')
