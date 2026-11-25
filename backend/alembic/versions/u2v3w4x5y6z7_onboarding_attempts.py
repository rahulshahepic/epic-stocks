"""Bounded, temporary onboarding attempts and anonymous cohort counters."""
from alembic import op
import sqlalchemy as sa

revision = 'u2v3w4x5y6z7'
down_revision = 't1u2v3w4x5y6'
branch_labels = depends_on = None


def upgrade():
    op.create_table('onboarding_attempts',
        sa.Column('token_hash', sa.String(64), primary_key=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('entrypoint', sa.String(8), nullable=False),
        sa.Column('flags', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('sequence', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completed_sequence', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('eligible', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('checked', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('claim_digest', sa.String(64)))
    op.create_index('ix_onboarding_attempts_expires_at', 'onboarding_attempts', ['expires_at'])
    op.create_table('onboarding_daily_stats',
        sa.Column('day', sa.Date(), primary_key=True),
        sa.Column('entrypoint', sa.String(8), primary_key=True),
        sa.Column('metric', sa.String(40), primary_key=True),
        sa.Column('count', sa.Integer(), nullable=False, server_default='0'))


def downgrade():
    op.drop_table('onboarding_daily_stats')
    op.drop_index('ix_onboarding_attempts_expires_at', table_name='onboarding_attempts')
    op.drop_table('onboarding_attempts')
