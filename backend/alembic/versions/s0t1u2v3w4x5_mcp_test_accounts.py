"""Isolated staging MCP test accounts.

Revision ID: s0t1u2v3w4x5
Revises: r9s0t1u2v3w4
"""
from alembic import op
import sqlalchemy as sa

revision = 's0t1u2v3w4x5'
down_revision = 'r9s0t1u2v3w4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('is_synthetic', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.create_table('mcp_test_accounts',
                    sa.Column('id', sa.Integer(), primary_key=True),
                    sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
                    sa.Column('grant_id', sa.Integer(), sa.ForeignKey('oauth_grants.id', ondelete='CASCADE'), unique=True, nullable=False),
                    sa.Column('synthetic_id', sa.Integer(), sa.ForeignKey('users.id'), unique=True, nullable=False),
                    sa.Column('scenario', sa.String(30), nullable=False),
                    sa.Column('fixture_version', sa.Integer(), nullable=False),
                    sa.Column('generation', sa.String(36), nullable=False),
                    sa.Column('last_used_at', sa.DateTime(), nullable=False))
    op.create_index('ix_mcp_test_accounts_user_id', 'mcp_test_accounts', ['user_id'])


def downgrade():
    # User rows must be erased through the canonical deletion service first.
    bind = op.get_bind()
    if bind.execute(sa.text('SELECT count(*) FROM users WHERE is_synthetic = :flag'), {'flag': True}).scalar():
        raise RuntimeError('Remove synthetic accounts through the deletion service before downgrading.')
    op.drop_table('mcp_test_accounts')
    op.drop_column('users', 'is_synthetic')
