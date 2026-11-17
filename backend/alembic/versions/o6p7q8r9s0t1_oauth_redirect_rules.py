"""OAuth redirect allowlist: exact/prefix callback rules, and a log of refusals

The allowlist held bare hosts, so allowing Claude meant any path on claude.ai.
Each row now carries a `match_type` (exact, prefix, host, loopback) and its
`pattern`, so a provider that publishes its callback is allowed that callback
and nothing else.

The three host rows the allowlist was seeded with (chatgpt.com, claude.ai,
claude.com) become those providers' exact callbacks, keeping whether each was
enabled. Existing connections are unaffected: a registered client is checked
against its provider's host at authorize and refresh, not its full URI. Every
other default (Gemini, Grok, Muse, Perplexity, Mistral, Manus, loopback) is
seeded on the next boot by scaffold/oauth/settings.py:seed_defaults; Claude and
ChatGPT are recorded as seeded here so a provider an admin removed before this
migration is not added back.

oauth_rejected_redirects records what registration refused, for the admin page.

Revision ID: o6p7q8r9s0t1
Revises: n5o6p7q8r9s0
Create Date: 2026-11-17 00:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'o6p7q8r9s0t1'
down_revision: Union[str, Sequence[str], None] = 'n5o6p7q8r9s0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Frozen copies: a migration must not change when the app's defaults do.
LEGACY = {
    'chatgpt.com': [
        ('ChatGPT', 'exact', 'https://chatgpt.com/connector_platform_oauth_redirect'),
        ('ChatGPT', 'prefix', 'https://chatgpt.com/connector/oauth/'),
    ],
    'claude.ai': [('Claude', 'exact', 'https://claude.ai/api/mcp/auth_callback')],
    'claude.com': [('Claude', 'exact', 'https://claude.com/api/mcp/auth_callback')],
}
SEEDED_KEY = 'oauth_default_redirects_seeded'


def upgrade() -> None:
    op.alter_column('oauth_redirect_hosts', 'host', new_column_name='pattern')
    op.drop_index('ix_oauth_redirect_hosts_host', table_name='oauth_redirect_hosts')
    op.create_index('ix_oauth_redirect_hosts_pattern', 'oauth_redirect_hosts', ['pattern'], unique=True)
    op.add_column('oauth_redirect_hosts', sa.Column(
        'match_type', sa.String(), nullable=False, server_default='host'))

    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, pattern, enabled FROM oauth_redirect_hosts WHERE match_type = 'host'"
    )).all()
    present = {r.pattern for r in bind.execute(sa.text("SELECT pattern FROM oauth_redirect_hosts")).all()}
    seeded = []
    for host, rules in LEGACY.items():
        seeded.extend(p for _, _, p in rules)
        legacy = next((r for r in rows if r.pattern == host), None)
        if legacy is None:
            continue
        for label, match_type, pattern in rules:
            if pattern not in present:
                bind.execute(sa.text(
                    "INSERT INTO oauth_redirect_hosts (label, pattern, match_type, enabled, created_at) "
                    "VALUES (:l, :p, :m, :e, CURRENT_TIMESTAMP)"
                ), {'l': label, 'p': pattern, 'm': match_type, 'e': legacy.enabled})
                present.add(pattern)
        bind.execute(sa.text("DELETE FROM oauth_redirect_hosts WHERE id = :id"), {'id': legacy.id})

    bind.execute(sa.text(
        "INSERT INTO system_settings (key, value) SELECT :k, :v "
        "WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = :k)"
    ), {'k': SEEDED_KEY, 'v': json.dumps(sorted(seeded))})

    op.create_table(
        'oauth_rejected_redirects',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('redirect_uri', sa.String(), nullable=False),
        sa.Column('client_name', sa.String(), nullable=True),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('attempts', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('first_seen', sa.DateTime(), nullable=True),
        sa.Column('last_seen', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_oauth_rejected_redirects_redirect_uri', 'oauth_rejected_redirects',
                    ['redirect_uri'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_oauth_rejected_redirects_redirect_uri', table_name='oauth_rejected_redirects')
    op.drop_table('oauth_rejected_redirects')
    op.execute(f"DELETE FROM system_settings WHERE key = '{SEEDED_KEY}'")
    # Back to bare hosts: every rule becomes its host, one row per host.
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, label, pattern, match_type, enabled FROM oauth_redirect_hosts ORDER BY id"
    )).all()
    from urllib.parse import urlparse
    seen = set()
    for r in rows:
        host = (urlparse(r.pattern).hostname if '://' in r.pattern else r.pattern) or r.pattern
        if host in seen:
            bind.execute(sa.text("DELETE FROM oauth_redirect_hosts WHERE id = :id"), {'id': r.id})
        else:
            seen.add(host)
            bind.execute(sa.text("UPDATE oauth_redirect_hosts SET pattern = :p WHERE id = :id"),
                         {'p': host.lower(), 'id': r.id})
    op.drop_column('oauth_redirect_hosts', 'match_type')
    op.drop_index('ix_oauth_redirect_hosts_pattern', table_name='oauth_redirect_hosts')
    op.alter_column('oauth_redirect_hosts', 'pattern', new_column_name='host')
    op.create_index('ix_oauth_redirect_hosts_host', 'oauth_redirect_hosts', ['host'], unique=True)
