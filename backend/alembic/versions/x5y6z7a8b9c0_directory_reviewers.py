"""Isolated production directory reviewer identities."""
from alembic import op
import sqlalchemy as sa
revision = 'x5y6z7a8b9c0'
down_revision = 'w4x5y6z7a8b9'
branch_labels = depends_on = None


def upgrade():
    op.create_table('reviewer_accounts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False, unique=True),
        sa.Column('login', sa.String(80), nullable=False, unique=True),
        sa.Column('platform', sa.String(12), nullable=False),
        sa.Column('scenario', sa.String(20), nullable=False),
        sa.Column('fixture_version', sa.Integer(), nullable=False),
        sa.Column('generation', sa.String(32), nullable=False),
        sa.Column('credential_hash', sa.String(64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True)),
        sa.Column('last_login_at', sa.DateTime(timezone=True)))

    op.create_table('reviewer_login_audit',
        sa.Column('bucket', sa.String(80), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('outcome', sa.String(10), nullable=False),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.Column('last_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_reviewer_login_audit_user_id', 'reviewer_login_audit', ['user_id'])
    op.create_index('ix_reviewer_login_audit_last_at', 'reviewer_login_audit', ['last_at'])


def downgrade():
    op.drop_table('reviewer_login_audit')
    op.drop_table('reviewer_accounts')
