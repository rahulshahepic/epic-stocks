"""Allow one isolated browser fixture per staging account.

Revision ID: t1u2v3w4x5y6
Revises: s0t1u2v3w4x5
"""
from alembic import op
import sqlalchemy as sa

revision = 't1u2v3w4x5y6'
down_revision = 's0t1u2v3w4x5'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('mcp_test_accounts') as batch:
        batch.alter_column('grant_id', existing_type=sa.Integer(), nullable=True)
    op.create_index('uq_mcp_test_browser_owner', 'mcp_test_accounts', ['user_id'], unique=True,
                    postgresql_where=sa.text('grant_id IS NULL'), sqlite_where=sa.text('grant_id IS NULL'))


def downgrade():
    if op.get_bind().execute(sa.text('SELECT count(*) FROM mcp_test_accounts WHERE grant_id IS NULL')).scalar():
        raise RuntimeError('Remove browser fixtures through the deletion service before downgrading.')
    op.drop_index('uq_mcp_test_browser_owner', table_name='mcp_test_accounts')
    with op.batch_alter_table('mcp_test_accounts') as batch:
        batch.alter_column('grant_id', existing_type=sa.Integer(), nullable=False)
