"""add oauth_clients, oauth_auth_codes and oauth_grants

The authorization server behind AI connectors. A user authorizes an assistant
(ChatGPT, Claude) once through the consent screen; the grant row is the live
connection, and deleting it is what revokes an outstanding connector token.

Secrets are stored as HMAC verifiers, never in redeemable form — the columns
holding them are named after what they verify, not what they contain.

Revision ID: d5e6f7g8h9i0
Revises: c4d5e6f7g8h9
Create Date: 2026-09-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5e6f7g8h9i0'
down_revision: Union[str, Sequence[str], None] = 'c4d5e6f7g8h9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'oauth_clients',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('client_id', sa.String(), nullable=False),
        sa.Column('client_secret', sa.String(), nullable=True),
        sa.Column('client_name', sa.String(), nullable=False),
        sa.Column('redirect_uris', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_oauth_clients_client_id', 'oauth_clients', ['client_id'], unique=True)
    op.create_index('ix_oauth_clients_created_at', 'oauth_clients', ['created_at'])

    op.create_table(
        'oauth_auth_codes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('client_id', sa.String(), nullable=False),
        sa.Column('redirect_uri', sa.String(), nullable=False),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('code_challenge', sa.String(), nullable=False),
        sa.Column('resource', sa.String(), nullable=True),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_oauth_auth_codes_code', 'oauth_auth_codes', ['code'], unique=True)
    op.create_index('ix_oauth_auth_codes_user_id', 'oauth_auth_codes', ['user_id'])
    op.create_index('ix_oauth_auth_codes_client_id', 'oauth_auth_codes', ['client_id'])
    op.create_index('ix_oauth_auth_codes_expires_at', 'oauth_auth_codes', ['expires_at'])

    op.create_table(
        'oauth_grants',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('client_id', sa.String(), nullable=False),
        sa.Column('client_name', sa.String(), nullable=False, server_default=''),
        sa.Column('scope', sa.String(), nullable=False),
        sa.Column('session_version', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('refresh_token', sa.String(), nullable=True),
        sa.Column('refresh_expires_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_oauth_grants_user_id', 'oauth_grants', ['user_id'])
    op.create_index('ix_oauth_grants_client_id', 'oauth_grants', ['client_id'])
    op.create_index('ix_oauth_grants_refresh_token', 'oauth_grants', ['refresh_token'], unique=True)
    op.create_index('ix_oauth_grants_created_at', 'oauth_grants', ['created_at'])


def downgrade() -> None:
    op.drop_table('oauth_grants')
    op.drop_table('oauth_auth_codes')
    op.drop_table('oauth_clients')
